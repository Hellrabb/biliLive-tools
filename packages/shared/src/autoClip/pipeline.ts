import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { parseDanmu } from "../danmu/index.js";
import { detectSignals } from "./signalDetector.js";
import { rankCandidates, preRankCandidates } from "./llmRanker.js";
import logger from "../utils/log.js";

import type { AutoClipConfig, VideoCodec, audioCodec } from "@biliLive-tools/types";
import type { AutoClipResult, DanmuStats, HighlightSegment } from "./types.js";

export type ProgressCallback = (stage: string, pct: number, message: string) => void;

export interface PipelineParams {
  videoPath: string;
  danmuPath: string;
  presetConfig: AutoClipConfig;
  onProgress?: ProgressCallback;
  sendMessage?: (prompt: string, signal?: AbortSignal) => Promise<string>;
  /** External result ID for async mode polling. Auto-generated if not provided. */
  id?: string;
}

/**
 * Main auto-clip pipeline:
 *   1. Parse danmaku XML → DanmuStats
 *   2. Layer 1: detect signal candidate windows
 *   3. Layer 2: LLM rank (or heuristic pre-rank if LLM disabled)
 *   4. Return AutoClipResult
 */
export async function runAutoClipPipeline(
  params: PipelineParams,
): Promise<AutoClipResult> {
  const { videoPath, danmuPath, presetConfig, onProgress, sendMessage } = params;
  const id = params.id ?? uuidv4();

  const llmFallback = presetConfig.llm.enabled && !sendMessage;

  onProgress?.("parse", 0, "Parsing danmaku...");

  // 1. Parse danmaku
  const parsed = await parseDanmu(danmuPath);
  const duration = await getVideoDuration(videoPath);

  const stats: DanmuStats = {
    danmu: parsed.danmu,
    sc: parsed.sc,
    gift: parsed.gift,
    guard: parsed.guard,
    videoStartTime: parsed.metadata.video_start_time ?? 0,
    duration,
  };

  onProgress?.(
    "parse",
    20,
    `Danmaku parsed: ${stats.danmu.length} danmaku, ${stats.sc.length} SC`,
  );

  // 2. Layer 1: Signal detection
  const candidates = detectSignals(stats, presetConfig.signal);

  if (candidates.length === 0) {
    onProgress?.("skip", 100, "No highlight signals detected, skipping");
    return {
      id,
      videoPath,
      danmuPath,
      highlights: [],
      skipped: true,
      skippedReason: "no_signal",
      ...(llmFallback ? { llmFallback } : {}),
    };
  }

  onProgress?.("detect", 50, `Detected ${candidates.length} candidate windows`);

  // 3. Layer 2: LLM ranking (or heuristic fallback)
  let highlights: HighlightSegment[];

  if (presetConfig.llm.enabled && sendMessage) {
    onProgress?.("rank", 60, "LLM ranking in progress...");
    const allDanmaku = stats.danmu.map(d => ({
      sec: d.timestamp ?? d.ts / 1000,
      text: d.text ?? "",
    }));
    highlights = await rankCandidates(candidates, presetConfig.llm, sendMessage, allDanmaku);
    onProgress?.(
      "rank",
      80,
      `LLM ranking complete: ${highlights.length} highlights kept`,
    );
  } else {
    // Without LLM, use pre-rank heuristic and wrap as HighlightSegment
    if (llmFallback) {
      logger.warn("AutoClip: LLM enabled but sendMessage unavailable — AI config may be incomplete, falling back to heuristic ranking");
    }
    const ranked = preRankCandidates(candidates, presetConfig.llm.topK);
    highlights = ranked.map((c) => ({
      timeRange: c.timeRange,
      bestRange: c.timeRange,
      score: 5,
      title: "Highlight",
      tags: [],
      highlightType: "hype" as const,
      reason: "Auto-detected (no LLM)",
      signalSources: c.signalSources,
      isHighlight: true,
    }));
  }

  onProgress?.("done", 100, `Complete: ${highlights.length} highlights`);
  return { id, videoPath, danmuPath, highlights, llmFallback };
}

export interface ExportClipsResult {
  success: Array<{ path: string; highlight: HighlightSegment }>;
  failed: Array<{ highlight: HighlightSegment; error: string }>;
}

/**
 * Export highlight clips to video files using the existing ffmpeg cut pipeline.
 *
 * Uses dynamic import for `task/video.js` to avoid circular dependencies
 * at module-load time. Returns structured result with per-clip success/failure
 * tracking so callers can distinguish partial success from total failure.
 */
export async function exportClips(
  videoPath: string,
  danmuPath: string,
  highlights: AutoClipResult["highlights"],
  exportConfig: AutoClipConfig["export"],
  onProgress?: ProgressCallback,
  namingPrefix?: string,
): Promise<ExportClipsResult> {
  const success: ExportClipsResult["success"] = [];
  const failed: ExportClipsResult["failed"] = [];

  const savePath = exportConfig.savePath || path.dirname(videoPath);

  // Resolve ffmpeg preset ONCE before the loop
  let ffmpegPresetOpts: Partial<Record<string, unknown>> = {};
  if (exportConfig.ffmpegPresetId) {
    try {
      const { container: diContainer } = await import("../index.js");
      const ffmpegPreset = diContainer.resolve("ffmpegPreset");
      const preset = await ffmpegPreset.get(exportConfig.ffmpegPresetId);
      if (preset?.config) {
        ffmpegPresetOpts = preset.config as unknown as Partial<Record<string, unknown>>;
      }
    } catch (err) {
      logger.warn(`AutoClip: failed to load ffmpeg preset "${exportConfig.ffmpegPresetId}", using defaults`, err);
    }
  }

  // --- Danmaku burning setup ---
  let assPath: string | undefined;
  if (exportConfig.burnDanmaku && danmuPath) {
    try {
      const { container: diContainer } = await import("../index.js");
      const danmuPreset = diContainer.resolve("danmuPreset");
      const danmuPresetId = exportConfig.danmuPresetId || "default";
      const danmuPresetRecord = await danmuPreset.get(danmuPresetId);
      const danmuConfig = danmuPresetRecord?.config ?? danmuPreset.defaultConfig;

      const { convertXml2Ass } = await import("../task/danmu.js");
      const { v4: uuid } = await import("uuid");
      const task = await convertXml2Ass(
        { input: danmuPath, output: uuid() },
        danmuConfig as any,
        { temp: true, saveRadio: 2, savePath: "", override: true },
      );
      // Wait for task completion (promisify event-based task)
      await new Promise<void>((resolve, reject) => {
        task.on("task-end", () => resolve());
        task.on("task-error", ({ error }: { error: string }) => reject(new Error(error)));
        task.on("task-cancel", () => reject(new Error("Danmaku conversion cancelled")));
      });
      assPath = task.output;
      logger.info(`AutoClip: danmaku ASS generated at ${assPath}`);
    } catch (err) {
      logger.warn("AutoClip: danmaku ASS generation failed, exporting without danmaku", err);
    }
  }

  // Dynamic import for cut once
  const { cut } = await import("../task/video.js");
  const { pathExists } = await import("fs-extra");

  for (let i = 0; i < highlights.length; i++) {
    const h = highlights[i]!;
    const safeTitle = (h.title || "clip").replace(/[\\/:*?"<>|]/g, "_");
    const escapeReplaceValue = (v: string) => v.replace(/\$/g, "$$$$");
    let outputName = exportConfig.namingTemplate
      .replace(/\{\{title\}\}/g, escapeReplaceValue(safeTitle))
      .replace(/\{\{index\}\}/g, String(i + 1));

    if (namingPrefix) {
      outputName = `${namingPrefix}_${outputName}`;
    }

    // Prevent filename collisions — append timestamp if file already exists
    let outputPath = path.join(
      savePath,
      `${outputName}.${exportConfig.cutFormat}`,
    );
    if (await pathExists(outputPath)) {
      const ts = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
      outputPath = path.join(
        savePath,
        `${outputName}_${ts}.${exportConfig.cutFormat}`,
      );
    }

    onProgress?.(
      "cut",
      Math.round((i / highlights.length) * 100),
      `Cutting: ${i + 1}/${highlights.length}`,
    );

    try {
      await cut(
        { videoFilePath: videoPath, assFilePath: assPath },
        outputPath,
        {
          ...ffmpegPresetOpts,
          // Use ffmpeg preset's encoder when preset is configured,
          // otherwise fall back to autoclip's export.encoder
          encoder: ((Object.keys(ffmpegPresetOpts).length > 0
            ? ffmpegPresetOpts.encoder
            : undefined) ?? exportConfig.encoder ?? "libx264") as VideoCodec,
          audioCodec: (exportConfig.audioCodec ?? "copy") as audioCodec,
          ss: h.bestRange[0],
          to: h.bestRange[1],
        },
        { saveType: 2, savePath, override: true },
      );
      success.push({ path: outputPath, highlight: h });
    } catch (error) {
      logger.error(`AutoClip export error for highlight ${i}:`, error);
      failed.push({ highlight: h, error: String(error) });
    }
  }

  return { success, failed };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function getVideoDuration(videoPath: string): Promise<number> {
  const { readVideoMeta } = await import("../task/video.js");
  const meta = await readVideoMeta(videoPath);
  const duration = meta?.format?.duration;
  if (!duration || duration <= 0) {
    throw new Error(`Cannot determine video duration for: ${videoPath}`);
  }
  return duration;
}
