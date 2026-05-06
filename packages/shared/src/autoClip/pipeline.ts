import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { parseDanmu } from "../danmu/index.js";
import { detectSignals } from "./signalDetector.js";
import { rankCandidates, preRankCandidates } from "./llmRanker.js";
import logger from "../utils/log.js";

import type { AutoClipConfig } from "@biliLive-tools/types";
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

  if (presetConfig.llm.enabled && sendMessage) {
    onProgress?.("rank", 60, "LLM ranking in progress...");
    highlights = await rankCandidates(candidates, presetConfig.llm, sendMessage);
    onProgress?.(
      "rank",
      80,
      `LLM ranking complete: ${highlights.length} highlights kept`,
    );
  } else {
    // Without LLM, use pre-rank heuristic and wrap as HighlightSegment
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
    }));
  }

  onProgress?.("done", 100, `Complete: ${highlights.length} highlights`);
  return { id, videoPath, danmuPath, highlights };
}

/**
 * Export highlight clips to video files using the existing ffmpeg cut pipeline.
 *
 * Uses dynamic import for `task/video.js` to avoid circular dependencies
 * at module-load time.
 */
export async function exportClips(
  videoPath: string,
  highlights: AutoClipResult["highlights"],
  exportConfig: AutoClipConfig["export"],
  onProgress?: ProgressCallback,
): Promise<string[]> {
  const outputFiles: string[] = [];

  for (let i = 0; i < highlights.length; i++) {
    const h = highlights[i];
    const safeTitle = (h.title || "clip").replace(/[\\/:*?"<>|]/g, "_");
    const outputName = exportConfig.namingTemplate
      .replace("{{title}}", safeTitle)
      .replace("{{index}}", String(i + 1))
      .replace("{{highlight_name}}", safeTitle);
    const outputPath = path.join(
      exportConfig.savePath,
      `${outputName}.${exportConfig.cutFormat}`,
    );

    onProgress?.(
      "cut",
      Math.round((i / highlights.length) * 100),
      `Cutting: ${i + 1}/${highlights.length}`,
    );

    try {
      // Dynamic import to avoid circular deps
      const { cut } = await import("../task/video.js");
      await cut(
        { videoFilePath: videoPath },
        outputPath,
        {
          encoder: "libx264",
          audioCodec: "copy",
          ss: h.bestRange[0],
          to: h.bestRange[1],
        },
        { saveType: 2, savePath: exportConfig.savePath },
      );
      outputFiles.push(outputPath);
    } catch (error) {
      logger.error(`AutoClip export error for highlight ${i}:`, error);
    }
  }

  return outputFiles;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const { readVideoMeta } = await import("../task/video.js");
    const meta = await readVideoMeta(videoPath);
    return meta?.format?.duration ?? 600;
  } catch {
    return 600;
  }
}
