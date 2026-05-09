import pLimit from "p-limit";
import type { AutoClipLLMConfig } from "@biliLive-tools/types";
import type {
  CandidateWindow,
  ClipCandidateContext,
  LLMRankResult,
  HighlightSegment,
  TimeWindow,
} from "./types.js";
import logger from "../utils/log.js";

// ---------------------------------------------------------------------------
// Default prompt template
// ---------------------------------------------------------------------------

const DEFAULT_PROMPT_TEMPLATE = `You are a live stream highlight detection assistant. Analyze the following danmaku data and determine if this segment is worth clipping.

Danmaku stats: {count} total danmaku, {density} danmaku/sec, SC total ¥{scTotal},
         {uniqueUsers} unique users, {brush} brush waves

SC records:
{sc_records}

Context before: {before}
Context after: {after}

Danmaku in window (time-ordered):
{danmaku}

Return ONLY valid JSON (no markdown, no extra text):
{
  "isHighlight": true/false,
  "score": 0-10,
  "title": "clip title (max 15 chars)",
  "tags": ["tag1", "tag2"],
  "highlightType": "funny/impressive/touching/hype/troll/not_highlight",
  "reason": "brief reason (max 20 chars)",
  "bestClipStart": start_second_within_window,
  "bestClipEnd": end_second_within_window
}`;

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

const LLM_CONCURRENCY = 3;
const LLM_REQUEST_TIMEOUT_MS = 30_000;

const MAX_SURROUNDING_ITEMS = 10;

// ---------------------------------------------------------------------------
// buildLLMPrompt
// ---------------------------------------------------------------------------

/**
 * Build an LLM prompt from a candidate context, replacing template placeholders
 * with actual values.
 */
export function buildLLMPrompt(
  ctx: ClipCandidateContext,
  template?: string,
): string {
  const tpl = template ?? DEFAULT_PROMPT_TEMPLATE;

  const scRecords =
    ctx.scSummary.length > 0
      ? ctx.scSummary
          .map((s) => `${s.user} ¥${s.amount}: ${s.message}`)
          .join("\n")
      : "(none)";

  const before =
    ctx.surroundingBefore.length > 0
      ? ctx.surroundingBefore.slice(0, MAX_SURROUNDING_ITEMS).join(" | ")
      : "(none)";

  const after =
    ctx.surroundingAfter.length > 0
      ? ctx.surroundingAfter.slice(0, MAX_SURROUNDING_ITEMS).join(" | ")
      : "(none)";

  const danmaku =
    ctx.danmakuSamples.length > 0
      ? ctx.danmakuSamples.map((d, i) => `${i + 1}. ${d}`).join("\n")
      : "(none)";

  return tpl
    .replace(/\{count\}/g, String(ctx.stats.danmakuCount))
    .replace(/\{density\}/g, String(ctx.stats.danmakuDensity))
    .replace(/\{scTotal\}/g, String(ctx.stats.scTotal))
    .replace(/\{uniqueUsers\}/g, String(ctx.stats.uniqueUsers))
    .replace(/\{brush\}/g, String(ctx.stats.brushFrequency))
    .replace(/\{sc_records\}/g, scRecords)
    .replace(/\{before\}/g, before)
    .replace(/\{after\}/g, after)
    .replace(/\{danmaku\}/g, danmaku);
}

// ---------------------------------------------------------------------------
// parseLLMResponse
// ---------------------------------------------------------------------------

const JSON_BLOCK_RE = /```(?:json)?\s*\n?([\s\S]*?)```/;
const JSON_OBJECT_RE = /\{[\s\S]*\}/;

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
    // 1. Extract JSON payload from the raw text
    let jsonStr = raw;

    // Try to extract from markdown code block first
    const blockMatch = raw.match(JSON_BLOCK_RE);
    if (blockMatch) {
      jsonStr = blockMatch[1]!.trim();
    } else {
      // Otherwise extract the first JSON object
      const objMatch = raw.match(JSON_OBJECT_RE);
      if (objMatch) {
        jsonStr = objMatch[0];
      }
    }

    // 2. Parse JSON
    const parsed = JSON.parse(jsonStr);

    // 3. Extract and coerce fields
    // Default to true when field is missing (backwards compat with custom prompts)
    // Only set to false when LLM explicitly returns false
    const isHighlight = parsed.isHighlight === false ? false : true;
    const score = typeof parsed.score === "number" ? parsed.score : 0;
    const title = typeof parsed.title === "string" ? parsed.title : "";
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter((t: unknown): t is string => typeof t === "string")
      : [];
    const reason = typeof parsed.reason === "string" ? parsed.reason : "";

    // 4. Validate highlightType
    let highlightType: LLMRankResult["highlightType"] = "not_highlight";
    if (typeof parsed.highlightType === "string") {
      const rawType = parsed.highlightType.trim().toLowerCase();
      if (VALID_HIGHLIGHT_TYPES.has(rawType)) {
        highlightType = rawType as LLMRankResult["highlightType"];
      }
    }

    // 5. Extract and clamp bestClipStart / bestClipEnd
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
// preRankCandidates
// ---------------------------------------------------------------------------

/**
 * Pre-rank candidates by heuristics so we can trim the list before sending to
 * the LLM (which is expensive).
 *
 * Score formula: `brushFrequency * 3 + scTotal / 10 + danmakuDensity`
 *
 * Candidates are sorted by this score in descending order, then sliced to
 * `maxCandidates`.
 */
export function preRankCandidates(
  candidates: CandidateWindow[],
  maxCandidates: number,
  weights?: AutoClipLLMConfig["heuristicWeights"],
): CandidateWindow[] {
  if (candidates.length === 0) return [];

  const w = weights ?? { brushFrequency: 3, scTotalDivisor: 10, danmakuDensity: 1 };

  const withScore = candidates.map((c) => {
    const { brushFrequency, scTotal, danmakuDensity } = c.stats;
    const heuristicScore =
      brushFrequency * w.brushFrequency +
      scTotal / w.scTotalDivisor +
      danmakuDensity * w.danmakuDensity;
    return { candidate: c, score: heuristicScore };
  });

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
  const danmakuSamples = candidate.danmakuSample
    .slice(0, maxSamples)
    .map((d) => d.text);

  // Surrounding context from raw danmaku timeline (NOT from other candidates)
  const beforeTexts: string[] = [];
  const afterTexts: string[] = [];

  for (const d of allDanmaku) {
    if (d.sec >= start - contextWindowSec && d.sec < start) {
      if (beforeTexts.length < MAX_SURROUNDING_ITEMS) {
        beforeTexts.push(d.text);
      }
    }
    if (d.sec > end && d.sec <= end + contextWindowSec) {
      if (afterTexts.length < MAX_SURROUNDING_ITEMS) {
        afterTexts.push(d.text);
      }
    }
    // Early exit if both buffers are full
    if (beforeTexts.length >= MAX_SURROUNDING_ITEMS && afterTexts.length >= MAX_SURROUNDING_ITEMS) {
      break;
    }
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
  sendMessage: (prompt: string) => Promise<string>,
  allDanmaku: Array<{ sec: number; text: string }>,
): Promise<HighlightSegment[]> {
  if (candidates.length === 0) return [];

  // Step 1: pre-rank if needed
  let ranked = candidates;
  if (candidates.length > config.maxCandidatesPerVideo) {
    ranked = preRankCandidates(candidates, config.maxCandidatesPerVideo, config.heuristicWeights);
  }

  // Step 2: build contexts
  const contexts = ranked.map((c) =>
    buildCandidateContext(c, allDanmaku, 30, config.danmakuSampleMax),
  );

  // Step 3: send to LLM with concurrency limit, timeout, and error isolation
  const limit = pLimit(LLM_CONCURRENCY);
  const sendWithTimeout = (prompt: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("LLM request timeout")), LLM_REQUEST_TIMEOUT_MS);
      sendMessage(prompt)
        .then((res) => { clearTimeout(timer); resolve(res); })
        .catch((err) => { clearTimeout(timer); reject(err); });
    });
  };

  const prompts = contexts.map((ctx) =>
    buildLLMPrompt(ctx, config.promptTemplate),
  );

  const rawResults = await Promise.allSettled(
    prompts.map((prompt) => limit(() => sendWithTimeout(prompt))),
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
      const w = config.heuristicWeights ?? { brushFrequency: 3, scTotalDivisor: 10, danmakuDensity: 1, highlightThreshold: 3 };
      const { brushFrequency, scTotal, danmakuDensity } = candidate.stats;
      const heuristicScore = Math.min(
        10,
        brushFrequency * w.brushFrequency + scTotal / w.scTotalDivisor + danmakuDensity * w.danmakuDensity,
      );
      results.push({
        candidate,
        parsed: {
          isHighlight: heuristicScore >= (w.highlightThreshold ?? 3),
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
