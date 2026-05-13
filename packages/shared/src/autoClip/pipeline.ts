import { v4 as uuidv4 } from "uuid";
import { parseDanmu } from "../danmu/index.js";
import { detectSignals } from "./signalDetector.js";
import { rankCandidates, preRankCandidates } from "./llmRanker.js";
import { detectSuspicious, applyFilter, llmReviewPatterns } from "./danmakuFilter.js";
import { understandContent } from "./contentUnderstanding.js";
import { generateStyledTitles } from "./titleStyler.js";
import { refineBoundaries } from "./boundaryRefiner.js";
import { getVideoDuration } from "./exportPipeline.js";
import logger from "../utils/log.js";

import type { AutoClipConfig } from "@biliLive-tools/types";
import type { AutoClipResult, DanmuStats, HighlightSegment, SuspiciousPattern, TitleStyleConfig } from "./types.js";

export type ProgressCallback = (stage: string, pct: number, message: string) => void;

export interface PipelineParams {
  videoPath: string;
  danmuPath: string;
  presetConfig: AutoClipConfig;
  onProgress?: ProgressCallback;
  sendMessage?: (prompt: string, signal?: AbortSignal) => Promise<string>;
  sendMultimodalMessage?: (prompt: string, images: string[], signal?: AbortSignal) => Promise<string>;
  recognizeASR?: (audioPath: string) => Promise<{ text: string }>;
  ffmpegPath?: string;
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
  const { videoPath, danmuPath, presetConfig, onProgress, sendMessage, sendMultimodalMessage, recognizeASR } = params;
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

  // 1.5: Danmaku filtering (detect → LLM review → apply)
  let suspiciousPatterns: SuspiciousPattern[] | undefined;
  const filterConfig = presetConfig.danmakuFilter ?? { enabled: true, rules: [], autoDetectEnabled: true };
  if (filterConfig.enabled && stats.danmu.length > 0) {
    const totalBefore = stats.danmu.length;

    if (filterConfig.autoDetectEnabled) {
      suspiciousPatterns = detectSuspicious(stats.danmu as Array<{ text: string }>);
      if (suspiciousPatterns.length > 0) {
        onProgress?.("filter", 25, `Detected ${suspiciousPatterns.length} suspicious danmaku patterns`);

        if (sendMessage) {
          const reviewResult = await llmReviewPatterns(suspiciousPatterns, sendMessage);
          suspiciousPatterns = reviewResult.patterns.map((p) => ({
            text: p.text,
            count: suspiciousPatterns!.find((sp) => sp.text === p.text)?.count ?? 0,
            similarity: suspiciousPatterns!.find((sp) => sp.text === p.text)?.similarity ?? 1.0,
            llmVerdict: p.verdict,
            llmReason: p.reason,
          }));

          if (reviewResult.newRules.length > 0) {
            filterConfig.rules = [...filterConfig.rules, ...reviewResult.newRules];
            onProgress?.("filter", 28, `LLM confirmed ${reviewResult.newRules.length} spam patterns`);
          }
        } else {
          onProgress?.("filter", 25, `Suspicious patterns detected (LLM unavailable, using statistical fallback)`);
          const now = Date.now();
          for (const p of suspiciousPatterns) {
            if (p.count >= 10 && p.similarity >= 0.9) {
              filterConfig.rules.push({
                id: uuidv4(),
                pattern: p.text,
                mode: p.similarity >= 0.95 ? "exact" : "contains",
                source: "auto",
                enabled: true,
                createdAt: now,
              });
            }
          }
        }
      }
    }

    if (filterConfig.rules.length > 0) {
      const result = applyFilter(stats.danmu, filterConfig);
      stats.danmu = result.filtered;
      onProgress?.(
        "filter",
        30,
        `Filtered ${result.removed}/${totalBefore} danmaku (${result.breakdown.length} rules)`,
      );
    }
  }

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
      suspiciousPatterns,
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

  // Build TitleStyleConfig from presetConfig.llm
  const titleStyleConfig: TitleStyleConfig | undefined =
    presetConfig.llm.titleStyleConfig || presetConfig.llm.titleStylePrompt
      ? {
          maxLength: presetConfig.llm.titleStyleConfig?.maxLength ?? 30,
          minLength: presetConfig.llm.titleStyleConfig?.minLength ?? 20,
          customPrompt: presetConfig.llm.titleStylePrompt || undefined,
        }
      : undefined;

  // 3.5 Phase 1.5: Content understanding + Phase 2: Styled titles
  if (highlights.length > 0 && sendMessage) {
    const enhancement = presetConfig.enhancement;
    const hasEnhancement = enhancement?.asrEnabled || enhancement?.visualEnabled;

    if (hasEnhancement) {
      onProgress?.("understand", 82, "Content understanding (ASR + visual)...");
      try {
        const { asrMap, frameMap } = await understandContent(
          videoPath,
          highlights,
          enhancement,
          { sendMultimodalMessage, recognizeASR, ffmpegPath: params.ffmpegPath },
        );
        onProgress?.("understand", 88, "Content understanding complete");

        // Phase 1.6: Boundary refinement
        if (presetConfig.enhancement.boundaryRefineEnabled) {
          onProgress?.("refine", 89, "Refining clip boundaries...");
          try {
            highlights = await refineBoundaries(
              highlights,
              asrMap,
              frameMap,
              sendMessage,
              {},
              duration,
            );
            onProgress?.("refine", 92, "Boundaries refined");
          } catch (err) {
            logger.warn("AutoClip: boundary refinement failed, using original boundaries", err);
          }
        }

        onProgress?.("title", 90, "Generating styled titles...");
        highlights = await generateStyledTitles(
          highlights,
          { asrMap, frameMap },
          sendMessage,
          titleStyleConfig,
        );
        onProgress?.("title", 95, `Styled titles generated for ${highlights.length} clips`);
      } catch (err) {
        logger.warn("AutoClip: content understanding / title styling failed, using Phase 1 titles", err);
      }
    } else {
      // Phase 2 only (no Phase 1.5 enrichment)
      onProgress?.("title", 90, "Generating styled titles...");
      try {
        highlights = await generateStyledTitles(
          highlights,
          { asrMap: new Map(), frameMap: new Map() },
          sendMessage,
          titleStyleConfig,
        );
        onProgress?.("title", 95, `Styled titles generated for ${highlights.length} clips`);
      } catch (err) {
        logger.warn("AutoClip: title styling failed, using Phase 1 content summaries", err);
      }
    }
  }

  onProgress?.("done", 100, `Complete: ${highlights.length} highlights`);
  return { id, videoPath, danmuPath, highlights, llmFallback, suspiciousPatterns };
}

// Re-export export types and functions (moved to exportPipeline.ts for separation of concerns)
export {
  type DanmakuStatus,
  type ExportClipsResult,
  type ExportPresetContext,
  resolveExportPresets,
  exportClips,
} from "./exportPipeline.js";
