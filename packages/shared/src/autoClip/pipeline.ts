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
  sendMessage?: (prompt: string) => Promise<string>;
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
  const id = uuidv4();

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
    };
  }

  onProgress?.("detect", 50, `Detected ${candidates.length} candidate windows`);

  // 3. Layer 2: LLM ranking (or heuristic fallback)
  let highlights: HighlightSegment[];

  const llmFallback = presetConfig.llm.enabled && !sendMessage;

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
  highlights: AutoClipResult["highlights"],
  exportConfig: AutoClipConfig["export"],
  onProgress?: ProgressCallback,
): Promise<ExportClipsResult> {
  const success: ExportClipsResult["success"] = [];
  const failed: ExportClipsResult["failed"] = [];

  const savePath = exportConfig.savePath || path.dirname(videoPath);

  for (let i = 0; i < highlights.length; i++) {
    const h = highlights[i]!;
    const safeTitle = (h.title || "clip").replace(/[\\/:*?"<>|]/g, "_");
    const outputName = exportConfig.namingTemplate
      .replace("{{title}}", safeTitle)
      .replace("{{index}}", String(i + 1))
      .replace("{{highlight_name}}", safeTitle);
    const outputPath = path.join(
      savePath,
      `${outputName}.${exportConfig.cutFormat}`,
    );

    onProgress?.(
      "cut",
      Math.round((i / highlights.length) * 100),
      `Cutting: ${i + 1}/${highlights.length}`,
    );

    try {
      // Load ffmpeg preset config if specified
      let ffmpegPresetOpts = {};
      if (exportConfig.ffmpegPresetId) {
        try {
          const { container: diContainer } = await import("../index.js");
          const ffmpegPreset = diContainer.resolve("ffmpegPreset");
          const preset = await ffmpegPreset.get(exportConfig.ffmpegPresetId);
          if (preset?.config) {
            ffmpegPresetOpts = { ...preset.config };
          }
        } catch (err) {
          logger.warn(`AutoClip: failed to load ffmpeg preset "${exportConfig.ffmpegPresetId}", using defaults`, err);
        }
      }

      // Dynamic import to avoid circular deps
      const { cut } = await import("../task/video.js");
      await cut(
        { videoFilePath: videoPath },
        outputPath,
        {
          ...ffmpegPresetOpts,
          encoder: (exportConfig.encoder ?? "libx264") as VideoCodec,
          audioCodec: (exportConfig.audioCodec ?? "copy") as audioCodec,
          ss: h.bestRange[0],
          to: h.bestRange[1],
        },
        { saveType: 2, savePath },
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
