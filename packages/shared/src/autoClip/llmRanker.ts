import pLimit from "p-limit";
import type { AutoClipLLMConfig } from "@biliLive-tools/types";
import type {
  CandidateWindow,
  ClipCandidateContext,
  LLMRankResult,
  HighlightSegment,
  TimeWindow,
} from "./types.js";
import { MAX_SURROUNDING_ITEMS } from "./constants.js";
import logger from "../utils/log.js";
import { LLM_CONCURRENCY } from "./constants.js";
import { sanitizeForPrompt, sanitizeDanmakuList } from "./promptSanitizer.js";
import { sendWithTimeout } from "./llmUtils.js";

// ---------------------------------------------------------------------------
// Default prompt template
// ---------------------------------------------------------------------------

const DEFAULT_PROMPT_TEMPLATE = `你是一个直播高光检测助手。分析以下弹幕数据，判断该片段是否值得切片。

弹幕统计：共 {count} 条，密度 {density} 条/秒，SC 总额 ¥{scTotal}，
         独立用户 {uniqueUsers} 人，弹幕刷屏比例 {brush}

SC 记录：
{sc_records}

上文的弹幕：{before}
下文的弹幕：{after}

窗口内的弹幕（按时间排序）：
{danmaku}

只返回合法 JSON（不要 markdown，不要额外文字）：
{
  "isHighlight": true/false,
  "score": 0-10,
  "title": "基于弹幕内容的一句话中文概述，客观描述发生了什么（不要修饰，不限字数）",
  "tags": ["标签1", "标签2"],
  "highlightType": "funny/impressive/touching/hype/troll/not_highlight",
  "reason": "简短原因（最多20字）",
  "bestClipStart": 高光起始的绝对秒数（相对于视频开始，不是相对于窗口）,
  "bestClipEnd": 高光结束的绝对秒数（相对于视频开始，不是相对于窗口）
}

注意：忽略抽奖刷屏和付费引流弹幕
（如"抽奖"、"关注抽"、"右上角"、"点关注送"等），
这些不反映观众真实互动——它们是机器/脚本营销内容。`;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_HIGHLIGHT_TYPES = new Set([
  "funny",
  "impressive",
  "touching",
  "hype",
  "troll",
  "not_highlight",
]);

// ---------------------------------------------------------------------------
// buildLLMPrompt
// ---------------------------------------------------------------------------

/**
 * Build an LLM prompt from a candidate context, replacing template placeholders
 * with actual values.
 */
export function buildLLMPrompt(ctx: ClipCandidateContext, template?: string): string {
  const tpl = template ?? DEFAULT_PROMPT_TEMPLATE;

  const scRecords =
    ctx.scSummary.length > 0
      ? ctx.scSummary
          .map((s) => `${sanitizeForPrompt(s.user)} ¥${s.amount}: ${sanitizeForPrompt(s.message)}`)
          .join("\n")
      : "(none)";

  const before =
    ctx.surroundingBefore.length > 0
      ? sanitizeDanmakuList(ctx.surroundingBefore).slice(0, MAX_SURROUNDING_ITEMS).join(" | ")
      : "(none)";

  const after =
    ctx.surroundingAfter.length > 0
      ? sanitizeDanmakuList(ctx.surroundingAfter).slice(0, MAX_SURROUNDING_ITEMS).join(" | ")
      : "(none)";

  const danmaku =
    ctx.danmakuSamples.length > 0
      ? sanitizeDanmakuList(ctx.danmakuSamples)
          .map((d, i) => `${i + 1}. ${d}`)
          .join("\n")
      : "(none)";

  return tpl
    .replace(/\{count\}/g, String(ctx.stats.danmakuCount))
    .replace(/\{density\}/g, String(ctx.stats.danmakuDensity))
    .replace(/\{scTotal\}/g, String(ctx.stats.scTotal))
    .replace(/\{uniqueUsers\}/g, String(ctx.stats.uniqueUsers))
    .replace(/\{brush\}/g, (ctx.stats.brushFrequency * 100).toFixed(0) + "%")
    .replace(/\{sc_records\}/g, scRecords)
    .replace(/\{before\}/g, before)
    .replace(/\{after\}/g, after)
    .replace(/\{danmaku\}/g, danmaku);
}

// ---------------------------------------------------------------------------
// parseLLMResponse
// ---------------------------------------------------------------------------

import { extractAndParseJSON } from "./jsonParser.js";

/**
 * Parse LLM JSON response into an `LLMRankResult`.
 *
 * - Strips markdown code fences if present.
 * - Extracts the first JSON object from the text.
 * - Clamps `bestClipStart` / `bestClipEnd` to `window` bounds.
 * - Validates `highlightType` against the allowed set; falls back to
 *   `"not_highlight"` on mismatch.
 * - On any parse failure returns a safe default with `isHighlight: false`.
 */
export function parseLLMResponse(raw: string, window: TimeWindow): LLMRankResult {
  const fallback = (): LLMRankResult => ({
    isHighlight: false,
    score: 0,
    title: "",
    tags: [],
    highlightType: "not_highlight",
    reason: "",
    bestClipStart: window[0],
    bestClipEnd: window[1],
  });

  try {
    // 1. Extract and parse JSON payload from the raw text
    const parsed = extractAndParseJSON<Record<string, unknown>>(raw);
    if (!parsed) return fallback();

    // 2. Extract score first (needed for isHighlight inference)
    const score = typeof parsed.score === "number" ? parsed.score : 0;

    // 3. Extract isHighlight — honor explicit value, infer from score when missing
    let isHighlight: boolean;
    if (typeof parsed.isHighlight === "boolean") {
      isHighlight = parsed.isHighlight;
    } else {
      const inferredType =
        typeof parsed.highlightType === "string" ? parsed.highlightType.trim().toLowerCase() : "";
      isHighlight = score >= 3 && inferredType !== "not_highlight";
    }

    // 4. Extract remaining fields
    const title = typeof parsed.title === "string" ? parsed.title : "";
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter((t: unknown): t is string => typeof t === "string")
      : [];
    const reason = typeof parsed.reason === "string" ? parsed.reason : "";

    // 5. Validate highlightType
    let highlightType: LLMRankResult["highlightType"] = "not_highlight";
    if (typeof parsed.highlightType === "string") {
      const rawType = parsed.highlightType.trim().toLowerCase();
      if (VALID_HIGHLIGHT_TYPES.has(rawType)) {
        highlightType = rawType as LLMRankResult["highlightType"];
      }
    }

    // 6. Extract and clamp bestClipStart / bestClipEnd
    let bestClipStart =
      typeof parsed.bestClipStart === "number" && Number.isFinite(parsed.bestClipStart)
        ? parsed.bestClipStart
        : window[0];
    let bestClipEnd =
      typeof parsed.bestClipEnd === "number" && Number.isFinite(parsed.bestClipEnd)
        ? parsed.bestClipEnd
        : window[1];

    // Clamp to window bounds
    bestClipStart = Math.max(window[0], Math.min(window[1], bestClipStart));
    bestClipEnd = Math.max(window[0], Math.min(window[1], bestClipEnd));

    // Ensure start < end
    if (bestClipStart >= bestClipEnd) {
      bestClipStart = window[0];
      bestClipEnd = window[1];
    }

    return {
      isHighlight,
      score: Math.max(0, Math.min(10, score)), // clamp score to 0-10
      title,
      tags,
      highlightType,
      reason,
      bestClipStart,
      bestClipEnd,
    };
  } catch {
    return fallback();
  }
}

// ---------------------------------------------------------------------------
// Heuristic scoring (shared between pre-rank and LLM fallback)
// ---------------------------------------------------------------------------

interface HeuristicWeights {
  brushFrequency: number;
  scTotalDivisor: number;
  danmakuDensity: number;
  highlightThreshold: number;
}

/**
 * Heuristic scoring weights for LLM fallback / pre-rank sorting.
 *
 * Chosen empirically to produce plausible ordering when LLM is unavailable:
 * - brushFrequency (3): brush storms are strong social proof — high weight
 * - scTotalDivisor (10): ¥300 ≈ 30 pts; keeps SC from dominating the score
 * - danmakuDensity (1): raw density has high variance; keep unit weight
 * - highlightThreshold (3): conservative cutoff — ~1σ above uniform baseline
 *
 * Tune these against labeled data for optimal precision/recall.
 */
const DEFAULT_HEURISTIC_WEIGHTS: HeuristicWeights = {
  brushFrequency: 3,
  scTotalDivisor: 10,
  danmakuDensity: 1,
  highlightThreshold: 3,
};

function computeHeuristicScore(
  stats: { brushFrequency: number; scTotal: number; danmakuDensity: number },
  weights?: Partial<HeuristicWeights>,
): number {
  const w = { ...DEFAULT_HEURISTIC_WEIGHTS, ...weights };
  return (
    stats.brushFrequency * w.brushFrequency +
    stats.scTotal / w.scTotalDivisor +
    stats.danmakuDensity * w.danmakuDensity
  );
}

// ---------------------------------------------------------------------------
// preRankCandidates
// ---------------------------------------------------------------------------

/**
 * Pre-rank candidates by heuristics so we can trim the list before sending to
 * the LLM (which is expensive).
 *
 * Score formula: `brushFrequency * w.brushFrequency + scTotal / w.scTotalDivisor + danmakuDensity * w.danmakuDensity`
 *
 * Candidates are sorted by this score in descending order, then sliced to
 * `maxCandidates`.
 */
export function preRankCandidates(
  candidates: CandidateWindow[],
  maxCandidates: number,
  weights?: Partial<HeuristicWeights>,
): CandidateWindow[] {
  if (candidates.length === 0) return [];
  const withScore = candidates.map((c) => ({
    candidate: c,
    score: computeHeuristicScore(c.stats, weights),
  }));
  withScore.sort((a, b) => b.score - a.score);
  return withScore.slice(0, maxCandidates).map((x) => x.candidate);
}

// ---------------------------------------------------------------------------
// buildCandidateContext
// ---------------------------------------------------------------------------

/**
 * Convert a `CandidateWindow` into a `ClipCandidateContext` ready for prompt
 * building. Surrounding context is sourced from the full danmaku timeline rather
 * than from other candidate windows' samples.
 */
function buildCandidateContext(
  candidate: CandidateWindow,
  allDanmaku: Array<{ sec: number; text: string }>,
  contextWindowSec: number,
  maxSamples: number,
): ClipCandidateContext {
  const [start, end] = candidate.timeRange;

  // Danmaku samples from this window (truncated to maxSamples)
  const danmakuSamples = candidate.danmakuSample.slice(0, maxSamples).map((d) => d.text);

  // Surrounding context from raw danmaku timeline (NOT from other candidates)
  const beforeTexts: string[] = [];
  const afterTexts: string[] = [];

  // Collect all danmaku in context windows with distance to boundary
  const beforeCandidates: Array<{ text: string; dist: number }> = [];
  const afterCandidates: Array<{ text: string; dist: number }> = [];

  for (const d of allDanmaku) {
    if (d.sec >= start - contextWindowSec && d.sec < start) {
      beforeCandidates.push({ text: d.text, dist: start - d.sec });
    }
    if (d.sec > end && d.sec <= end + contextWindowSec) {
      afterCandidates.push({ text: d.text, dist: d.sec - end });
    }
  }

  // Sort by distance to boundary (closest first), then take top N
  beforeCandidates.sort((a, b) => a.dist - b.dist);
  afterCandidates.sort((a, b) => a.dist - b.dist);

  for (let i = 0; i < Math.min(MAX_SURROUNDING_ITEMS, beforeCandidates.length); i++) {
    beforeTexts.push(beforeCandidates[i]!.text);
  }
  for (let i = 0; i < Math.min(MAX_SURROUNDING_ITEMS, afterCandidates.length); i++) {
    afterTexts.push(afterCandidates[i]!.text);
  }

  return {
    windowStart: start,
    windowEnd: end,
    danmakuSamples,
    scSummary: candidate.scSummary,
    stats: candidate.stats,
    surroundingBefore: beforeTexts,
    surroundingAfter: afterTexts,
  };
}

// ---------------------------------------------------------------------------
// rankCandidates
// ---------------------------------------------------------------------------

/**
 * Full ranking pipeline:
 *
 * 1. If the candidate count exceeds `maxCandidatesPerVideo`, pre-rank by
 *    heuristics to trim the list.
 * 2. Build a `ClipCandidateContext` for each candidate.
 * 3. Send each context to the LLM via the `sendMessage` callback (parallel).
 * 4. Parse responses into `LLMRankResult`.
 * 5. Filter out results with `score <= 0`.
 * 6. Sort by score descending, then slice to `config.topK`.
 * 7. Return as `HighlightSegment[]`.
 */
export async function rankCandidates(
  candidates: CandidateWindow[],
  config: AutoClipLLMConfig,
  sendMessage: (prompt: string, signal?: AbortSignal) => Promise<string>,
  allDanmaku: Array<{ sec: number; text: string }>,
  signal?: AbortSignal,
): Promise<HighlightSegment[]> {
  if (candidates.length === 0) return [];

  // Step 1: pre-rank if needed
  let ranked = candidates;
  if (candidates.length > config.maxCandidatesPerVideo) {
    ranked = preRankCandidates(candidates, config.maxCandidatesPerVideo, config.heuristicWeights);
  }

  // Step 2: build contexts
  const contexts = ranked.map((c) =>
    buildCandidateContext(c, allDanmaku, config.contextWindowSec ?? 30, config.danmakuSampleMax),
  );

  // Step 3: send to LLM with concurrency limit, timeout, and error isolation
  const limit = pLimit(LLM_CONCURRENCY);

  const prompts = contexts.map((ctx) => buildLLMPrompt(ctx, config.promptTemplate));

  const rawResults = await Promise.allSettled(
    prompts.map((prompt) =>
      limit(() => sendWithTimeout(sendMessage, prompt, { externalSignal: signal })),
    ),
  );

  // Step 4: parse responses — fulfilled → parse, rejected → heuristic fallback
  const results: Array<{
    candidate: CandidateWindow;
    parsed: LLMRankResult;
  }> = [];
  for (let i = 0; i < ranked.length; i++) {
    const candidate = ranked[i]!;
    const outcome = rawResults[i]!;
    if (outcome.status === "fulfilled") {
      const parsed = parseLLMResponse(outcome.value, candidate.timeRange);
      results.push({ candidate, parsed });
    } else {
      // LLM call failed — use heuristic fallback score with configured weights
      logger.warn(`AutoClip LLM call failed for candidate ${i}: ${outcome.reason}`);
      const heuristicWeights = config.heuristicWeights ?? {};
      const heuristicScore = Math.max(
        0,
        Math.min(10, computeHeuristicScore(candidate.stats, heuristicWeights)),
      );
      const highlightThreshold = config.heuristicWeights?.highlightThreshold ?? 3;
      results.push({
        candidate,
        parsed: {
          isHighlight: heuristicScore >= highlightThreshold,
          score: heuristicScore,
          title: "Auto-detected",
          tags: [],
          highlightType: "hype",
          reason: "LLM unavailable, heuristic fallback",
          bestClipStart: candidate.timeRange[0],
          bestClipEnd: candidate.timeRange[1],
        },
      });
    }
  }

  // Step 5-7: filter by isHighlight AND score, sort, slice, convert
  const highlights: HighlightSegment[] = results
    .filter((r) => r.parsed.isHighlight && r.parsed.score > 0)
    .sort((a, b) => b.parsed.score - a.parsed.score)
    .slice(0, config.topK)
    .map((r) => ({
      timeRange: r.candidate.timeRange,
      bestRange: [r.parsed.bestClipStart, r.parsed.bestClipEnd] as TimeWindow,
      score: r.parsed.score,
      title: r.parsed.title,
      tags: r.parsed.tags,
      highlightType: r.parsed.highlightType,
      reason: r.parsed.reason,
      signalSources: r.candidate.signalSources,
      isHighlight: r.parsed.isHighlight,
    }));

  return highlights;
}

// ---------------------------------------------------------------------------
// Re-export DEFAULT_PROMPT_TEMPLATE for testing / customization
// ---------------------------------------------------------------------------

export { DEFAULT_PROMPT_TEMPLATE };
