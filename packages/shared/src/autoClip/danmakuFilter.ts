import { v4 as uuidv4 } from "uuid";
import type { SuspiciousPattern } from "./types.js";
import type { DanmakuFilterRule, DanmakuFilterConfig } from "@biliLive-tools/types";
import logger from "../utils/log.js";
import { MAX_REGEX_PATTERN_LENGTH } from "./constants.js";
import { extractAndParseJSON } from "./jsonParser.js";
import { sanitizeForPrompt } from "./promptSanitizer.js";
import { sendWithTimeout } from "./llmUtils.js";

export interface DetectSuspiciousOptions {
  minOccurrence: number;
  topK: number;
  minTextLength: number;
  maxTextLength: number;
}

const DEFAULT_OPTIONS: DetectSuspiciousOptions = {
  minOccurrence: 5,
  topK: 20,
  minTextLength: 3,
  maxTextLength: 80,
};

const PURE_SYMBOL_RE = /^[\d\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]+$/;

/**
 * Detect suspicious danmaku patterns from a list of danmaku items.
 *
 * Algorithm:
 * 1. Pre-filter: remove too-short/long text, pure symbols
 * 2. Exact-match grouping: count identical texts
 * 3. Similarity clustering: merge groups with Dice coefficient >= 0.7
 * 4. Sort by count desc, take topK
 */
export function detectSuspicious(
  danmu: Array<{ text: string }>,
  options?: Partial<DetectSuspiciousOptions>,
): SuspiciousPattern[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Time-bucket stratified sampling for large inputs
  let sample = danmu;
  if (danmu.length > 5000) {
    const NUM_BUCKETS = 100;
    const bucketSize = Math.ceil(danmu.length / NUM_BUCKETS);
    const sampled: Array<{ text: string }> = [];
    for (let b = 0; b < NUM_BUCKETS; b++) {
      const start = b * bucketSize;
      const end = Math.min(start + bucketSize, danmu.length);
      const bucket = danmu.slice(start, end);
      const bucketSampleSize = Math.max(1, Math.ceil(bucket.length * 0.25));
      const step = Math.max(1, Math.floor(bucket.length / bucketSampleSize));
      for (let i = 0; i < bucket.length; i += step) {
        sampled.push(bucket[i]!);
      }
    }
    sample = sampled;
  }

  // Pre-filter + exact-match grouping
  const countMap = new Map<string, number>();
  for (const d of sample) {
    const t = d.text?.trim() ?? "";
    if (t.length < opts.minTextLength || t.length > opts.maxTextLength) continue;
    if (PURE_SYMBOL_RE.test(t)) continue;
    countMap.set(t, (countMap.get(t) ?? 0) + 1);
  }

  const entries = [...countMap.entries()]
    .filter(([, count]) => count >= opts.minOccurrence)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) return [];

  // Similarity clustering using Dice coefficient
  interface Cluster { texts: string[]; bestText: string; totalCount: number; similarities: number[] }
  const clusters: Cluster[] = [];
  const assigned = new Set<string>();

  function diceCoefficient(a: string, b: string): number {
    if (a === b) return 1.0;
    const aGrams = new Set<string>();
    const bGrams = new Set<string>();
    for (let i = 0; i < a.length - 1; i++) aGrams.add(a.slice(i, i + 2));
    for (let i = 0; i < b.length - 1; i++) bGrams.add(b.slice(i, i + 2));
    if (aGrams.size === 0 && bGrams.size === 0) return 1.0;
    let overlap = 0;
    for (const g of aGrams) { if (bGrams.has(g)) overlap++; }
    return (2 * overlap) / (aGrams.size + bGrams.size);
  }

  for (const [text, count] of entries) {
    if (assigned.has(text)) continue;

    let bestClusterIdx = -1;
    let maxSim = 0;
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i]!;
      let totalSim = 0;
      for (const ct of cluster.texts) {
        totalSim += diceCoefficient(text, ct);
      }
      const avgSim = totalSim / cluster.texts.length;
      if (avgSim > maxSim && avgSim >= 0.7) {
        maxSim = avgSim;
        bestClusterIdx = i;
      }
    }

    if (bestClusterIdx >= 0) {
      const cluster = clusters[bestClusterIdx]!;
      cluster.texts.push(text);
      cluster.totalCount += count;
      cluster.similarities.push(maxSim);
      // Update bestText if this entry has higher individual count
      if (count > (countMap.get(cluster.bestText) ?? 0)) {
        cluster.bestText = text;
      }
    } else {
      clusters.push({ texts: [text], bestText: text, totalCount: count, similarities: [] });
    }
    assigned.add(text);
  }

  return clusters
    .map((c) => ({
      text: c.bestText,
      count: c.totalCount,
      similarity: c.similarities.length > 0
        ? c.similarities.reduce((a, b) => a + b, 0) / c.similarities.length
        : 1.0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, opts.topK);
}

// --- applyFilter ------------------------------------------------------------

export interface FilterResult<T extends { text?: string } = { text?: string }> {
  filtered: T[];
  removed: number;
  breakdown: Array<{ ruleId: string; pattern: string; removed: number }>;
}

export function applyFilter<T extends { text?: string }>(
  danmu: T[],
  config: DanmakuFilterConfig,
): FilterResult<T> {
  if (!config.enabled || config.rules.length === 0) {
    return { filtered: danmu, removed: 0, breakdown: [] };
  }

  const breakdownMap = new Map<string, { pattern: string; removed: number }>();
  const activeRules = config.rules.filter((r) => r.enabled);

  const compiled: Array<{ id: string; pattern: string; test: (text: string) => boolean }> = [];
  for (const rule of activeRules) {
    let matchFn: (text: string) => boolean;
    switch (rule.mode) {
      case "exact":
        matchFn = (text: string) => text.trim() === rule.pattern;
        break;
      case "contains":
        matchFn = (text: string) => text.includes(rule.pattern);
        break;
      case "regex": {
        const pattern = rule.pattern;
        if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
          logger.warn(`AutoClip: regex pattern too long (${pattern.length} chars), skipping rule ${rule.id}`);
          continue;
        }
        // Reject patterns with nested quantifiers — common ReDoS vector
        if (/[+*?]\)[+*?]/.test(pattern)) {
          logger.warn(`AutoClip: potentially unsafe regex pattern, skipping rule ${rule.id}`);
          continue;
        }
        try {
          const re = new RegExp(pattern);
          matchFn = (text: string) => re.test(text);
        } catch {
          logger.warn(`AutoClip: invalid regex pattern in filter rule ${rule.id}: ${pattern}`);
          continue;
        }
        break;
      }
    }
    compiled.push({ id: rule.id, pattern: rule.pattern, test: matchFn });
  }

  const filtered: T[] = [];
  for (const d of danmu) {
    let matched = false;
    for (const rule of compiled) {
      if (rule.test(d.text ?? "")) {
        matched = true;
        const entry = breakdownMap.get(rule.id);
        if (entry) {
          entry.removed++;
        } else {
          breakdownMap.set(rule.id, { pattern: rule.pattern, removed: 1 });
        }
        break;
      }
    }
    if (!matched) {
      filtered.push(d);
    }
  }

  const breakdown = [...breakdownMap.entries()].map(([ruleId, v]) => ({
    ruleId,
    pattern: v.pattern,
    removed: v.removed,
  }));

  return {
    filtered,
    removed: danmu.length - filtered.length,
    breakdown,
  };
}

// --- llmReviewPatterns ------------------------------------------------------

export interface LLMReviewResult {
  patterns: Array<{
    text: string;
    verdict: "spam" | "not_spam";
    reason: string;
  }>;
  newRules: DanmakuFilterRule[];
}

/**
 * Send suspicious patterns to LLM for batch review.
 * LLM-confirmed spam patterns are converted to DanmakuFilterRules.
 *
 * On LLM failure, falls back to statistical rule:
 *   count >= 10 AND similarity >= 0.9 → auto-mark as spam
 */
export async function llmReviewPatterns(
  patterns: SuspiciousPattern[],
  sendMessage: (prompt: string, signal?: AbortSignal) => Promise<string>,
  signal?: AbortSignal,
): Promise<LLMReviewResult> {
  if (patterns.length === 0) {
    return { patterns: [], newRules: [] };
  }

  // M8: Batch patterns to avoid context overflow on small-window models
  const MAX_BATCH_CHARS = 3000;
  const batches: SuspiciousPattern[][] = [];
  let currentBatch: SuspiciousPattern[] = [];
  let currentChars = 0;

  for (const p of patterns) {
    const itemChars = sanitizeForPrompt(p.text).length + 50; // overhead for index/count/similarity
    if (currentChars + itemChars > MAX_BATCH_CHARS && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentChars = 0;
    }
    currentBatch.push(p);
    currentChars += itemChars;
  }
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  const buildPrompt = (batch: SuspiciousPattern[], offset: number) => {
    const list = batch
      .map((p, i) => `${offset + i + 1}. "${sanitizeForPrompt(p.text)}" (count=${p.count}, similarity=${p.similarity.toFixed(2)})`)
      .join("\n");

    return `You are a danmaku spam classifier. Determine if each danmaku pattern is lottery spam (抽奖广告垃圾弹幕) or legitimate audience engagement (正常观众互动).

Lottery spam indicators: mentions of raffle/lottery (抽奖/抽/抽送), encouraging follows for rewards (关注抽/关注送/点关注), diamond/coin giveaways (钻石/金币/红包/福利), right-corner UI references (右上角), or any paid-promotion CTAs.

Legitimate indicators: viewer reactions (哈哈哈/666/主播牛逼/？？？/厉害了/卧槽), gameplay commentary, sincere compliments, emotes, or questions.

For each pattern, return verdict: "spam" or "not_spam" with a brief reason (max 10 chars in Chinese).

Patterns:
${list}

Return ONLY valid JSON (no markdown, no extra text):
{
  "results": [
    {"index": ${offset + 1}, "verdict": "spam", "reason": "抽奖引导话术"},
    {"index": ${offset + 2}, "verdict": "not_spam", "reason": "观众自然反应"}
  ]
}`;
  };

  let parsed: Array<{ index: number; verdict: string; reason: string }> = [];

  try {
    let offset = 0;
    for (const batch of batches) {
      const prompt = buildPrompt(batch, offset);
      const raw = await sendWithTimeout(sendMessage, prompt, { externalSignal: signal });

      const parsedJson = extractAndParseJSON<{ results?: Array<{ index: number; verdict: string; reason: string }> }>(raw);
      if (parsedJson && Array.isArray(parsedJson.results)) {
        parsed.push(...parsedJson.results);
      }
      offset += batch.length;
    }
  } catch (err) {
    const isTimeout = err instanceof Error && err.message === "LLM request timeout";
    if (isTimeout) {
      logger.warn("AutoClip: LLM review of suspicious patterns timed out, using statistical fallback");
    } else {
      logger.warn("AutoClip: LLM review of suspicious patterns failed, using statistical fallback", err);
    }
  }

  if (parsed.length === 0) {
    return statisticsFallback(patterns);
  }

  const now = Date.now();
  const newRules: DanmakuFilterRule[] = [];

  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i]!;
    const llmResult = parsed.find((r) => r.index === i + 1);
    if (llmResult?.verdict === "spam") {
      const mode = pattern.similarity >= 0.95 ? "exact" : "contains";
      newRules.push({
        id: uuidv4(),
        pattern: pattern.text,
        mode,
        source: "auto",
        enabled: true,
        createdAt: now,
      });
    }
  }

  return {
    patterns: patterns.map((p, i) => {
      const r = parsed.find((x) => x.index === i + 1);
      return {
        text: p.text,
        verdict: (r?.verdict === "spam" ? "spam" : "not_spam") as "spam" | "not_spam",
        reason: r?.reason ?? "",
      };
    }),
    newRules,
  };
}

function statisticsFallback(patterns: SuspiciousPattern[]): LLMReviewResult {
  const now = Date.now();
  const newRules: DanmakuFilterRule[] = [];

  for (const p of patterns) {
    if (p.count >= 10 && p.similarity >= 0.9) {
      newRules.push({
        id: uuidv4(),
        pattern: p.text,
        mode: p.similarity >= 0.95 ? "exact" : "contains",
        source: "auto",
        enabled: true,
        createdAt: now,
      });
    }
  }

  return {
    patterns: patterns.map((p) => ({
      text: p.text,
      verdict: (p.count >= 10 && p.similarity >= 0.9 ? "spam" : "not_spam") as "spam" | "not_spam",
      reason: p.count >= 10 && p.similarity >= 0.9 ? "统计判定垃圾弹幕" : "",
    })),
    newRules,
  };
}
