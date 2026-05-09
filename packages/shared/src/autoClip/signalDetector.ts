import type { DanmuItem, SC, Gift, AutoClipSignalConfig } from "@biliLive-tools/types";
import type { CandidateWindow, TimeWindow, DanmuStats, DanmuSample, SCSummary } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract seconds from a DanmuItem — prefers `timestamp`, falls back to `ts/1000`. */
function itemSec(item: DanmuItem): number {
  return item.timestamp ?? item.ts / 1000;
}

/**
 * Longest-common-substring similarity (ratio).
 * Classic DP O(m*n), returns maxSubLen / min(a.length, b.length).
 */
function lcsSimilarity(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;

  // Use two-row DP to save memory
  const prev = new Uint16Array(n + 1);
  const curr = new Uint16Array(n + 1);
  let maxLen = 0;

  for (let i = 1; i <= m; i++) {
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      if (ca === b.charCodeAt(j - 1)) {
        const val = prev[j - 1] + 1;
        curr[j] = val;
        if (val > maxLen) maxLen = val;
      } else {
        curr[j] = 0;
      }
    }
    // swap rows
    const tmp = prev;
    prev.set(curr);
    curr.set(tmp);
  }

  return maxLen / Math.min(m, n);
}

/** Merge overlapping / adjacent TimeWindow arrays (copies input, does not mutate). */
function mergeTimeWindows(windows: TimeWindow[], gapSec: number): TimeWindow[] {
  if (windows.length === 0) return [];
  const sorted = [...windows].sort((a, b) => a[0] - b[0]);

  const merged: TimeWindow[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur[0] <= last[1] + gapSec) {
      // overlap or within gap → merge
      last[1] = Math.max(last[1], cur[1]);
    } else {
      merged.push([cur[0], cur[1]]);
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Signal A: Danmaku density peaks
// ---------------------------------------------------------------------------

/**
 * Detect time windows where danmaku density exceeds the baseline.
 *
 * Algorithm:
 * 1. Bucket the timeline into equal-width `bucketSec` intervals.
 * 2. Compute mean μ and population standard deviation σ of bucket counts.
 * 3. Any bucket whose count > μ + danmakuDensityThreshold * σ is "hot".
 * 4. Merge adjacent hot buckets when the gap ≤ mergeGapSec seconds.
 * 5. Expand each merged range by `windowPadding`.
 */
export function detectDanmakuDensityPeaks(
  items: DanmuItem[],
  durationSec: number,
  config: AutoClipSignalConfig,
): TimeWindow[] {
  const { bucketSec, danmakuDensityThreshold, mergeGapSec, windowPadding } = config;

  if (durationSec <= 0 || bucketSec <= 0) return [];

  const numBuckets = Math.ceil(durationSec / bucketSec);
  const buckets = new Array<number>(numBuckets).fill(0);

  // Fill buckets
  for (const item of items) {
    const sec = itemSec(item);
    if (sec < 0 || sec >= durationSec) continue;
    const idx = Math.floor(sec / bucketSec);
    if (idx >= 0 && idx < numBuckets) {
      buckets[idx]!++;
    }
  }

  // Mean and population standard deviation
  let sum = 0;
  for (const c of buckets) sum += c;
  const mean = sum / numBuckets;
  let variance = 0;
  for (const c of buckets) variance += (c - mean) ** 2;
  const std = Math.sqrt(variance / numBuckets);

  const threshold = mean + danmakuDensityThreshold * std;

  // Find hot buckets (indices)
  const hotIndices: number[] = [];
  for (let i = 0; i < numBuckets; i++) {
    if (buckets[i]! > threshold) {
      hotIndices.push(i);
    }
  }

  if (hotIndices.length === 0) return [];

  // Group contiguous hot indices
  const groups: Array<[number, number]> = []; // [startIdx, endIdx] inclusive
  let groupStart = hotIndices[0]!;
  let groupEnd = hotIndices[0]!;
  for (let i = 1; i < hotIndices.length; i++) {
    const idx = hotIndices[i]!;
    if (idx === groupEnd + 1) {
      groupEnd = idx;
    } else {
      groups.push([groupStart, groupEnd]);
      groupStart = idx;
      groupEnd = idx;
    }
  }
  groups.push([groupStart, groupEnd]);

  // Merge groups that are within mergeGapSec of each other
  const gapBuckets = Math.ceil(mergeGapSec / bucketSec);
  const mergedGroups: Array<[number, number]> = [groups[0]!];
  for (let i = 1; i < groups.length; i++) {
    const last = mergedGroups[mergedGroups.length - 1]!;
    const cur = groups[i]!;
    if (cur[0] <= last[1] + gapBuckets) {
      last[1] = Math.max(last[1], cur[1]);
    } else {
      mergedGroups.push([cur[0], cur[1]]);
    }
  }

  // Convert to TimeWindow and expand by padding
  const result: TimeWindow[] = mergedGroups.map(([startIdx, endIdx]) => {
    const rawStart = startIdx * bucketSec;
    const rawEnd = (endIdx + 1) * bucketSec;
    return [
      Math.max(0, rawStart - windowPadding[0]),
      Math.min(durationSec, rawEnd + windowPadding[1]),
    ] as TimeWindow;
  });

  return result;
}

// ---------------------------------------------------------------------------
// Signal B: SC (Super Chat) bursts
// ---------------------------------------------------------------------------

/**
 * Detect time windows where the total SC amount within a sliding window
 * reaches or exceeds `scMinAmount`.
 */
export function detectSCBursts(sc: SC[], config: AutoClipSignalConfig): TimeWindow[] {
  const { scMinAmount, giftBurstWindowSec } = config;

  if (sc.length === 0 || scMinAmount <= 0) return [];

  // Sort by timestamp ascending
  const sorted = [...sc].sort((a, b) => itemSec(a) - itemSec(b));

  const rawWindows: TimeWindow[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const anchor = itemSec(sorted[i]!);
    let total = 0;
    let maxTs = anchor;

    for (let j = i; j < sorted.length; j++) {
      const ts = itemSec(sorted[j]!);
      if (ts - anchor > giftBurstWindowSec) break;
      total += sorted[j]!.gift_price ?? 0;
      maxTs = ts;
    }

    if (total >= scMinAmount) {
      rawWindows.push([anchor, maxTs]);
    }
  }

  // Merge overlapping windows (0 gap because the sliding approach already overlaps)
  return mergeTimeWindows(rawWindows, 0);
}

// ---------------------------------------------------------------------------
// Signal C: Gift bursts
// ---------------------------------------------------------------------------

/**
 * Detect time windows where the number of gifts within a sliding window
 * reaches or exceeds `giftBurstThreshold`.
 */
export function detectGiftBursts(gifts: Gift[], config: AutoClipSignalConfig): TimeWindow[] {
  const { giftBurstThreshold, giftBurstWindowSec } = config;

  if (gifts.length === 0 || giftBurstThreshold <= 0) return [];

  const sorted = [...gifts].sort((a, b) => itemSec(a) - itemSec(b));

  const rawWindows: TimeWindow[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const anchor = itemSec(sorted[i]!);
    let count = 0;
    let maxTs = anchor;

    for (let j = i; j < sorted.length; j++) {
      const ts = itemSec(sorted[j]!);
      if (ts - anchor > giftBurstWindowSec) break;
      count++;
      maxTs = ts;
    }

    if (count >= giftBurstThreshold) {
      rawWindows.push([anchor, maxTs]);
    }
  }

  return mergeTimeWindows(rawWindows, 0);
}

// ---------------------------------------------------------------------------
// Signal D: Brush storms (content similarity)
// ---------------------------------------------------------------------------

/** Sliding window size for brush storm detection (seconds). */
const BRUSH_WINDOW_SEC = 10;
/** Max items per sliding window for pair-wise LCS to prevent O(n²) blowup. */
const MAX_BRUSH_SAMPLE = 80;
/** Max danmaku texts for brush-frequency pair-wise LCS in detectSignals. */
const MAX_BRUSH_FREQ_SAMPLE = 150;

/**
 * Detect time windows where a high proportion of danmaku text pairs share
 * similar content, indicating a "brush storm" (刷屏).
 *
 * Uses a sliding 10-second window.  Within each window the LCS similarity
 * is computed for all pairs; if ≥30% of pairs exceed `brushSimilarityThreshold`,
 * the window is marked.
 */
export function detectBrushStorms(
  items: DanmuItem[],
  config: AutoClipSignalConfig,
): TimeWindow[] {
  const { brushSimilarityThreshold } = config;

  // Only consider items that have text content
  const withText = items.filter((d) => d.text && d.text.trim().length > 0);

  if (withText.length < 2) return [];

  // Sort by timestamp
  const sorted = [...withText].sort((a, b) => itemSec(a) - itemSec(b));

  const rawWindows: TimeWindow[] = [];

  // Slide through sorted items
  for (let i = 0; i < sorted.length; i++) {
    const anchor = itemSec(sorted[i]!);
    const windowEnd = anchor + BRUSH_WINDOW_SEC;

    // Collect items in this window
    const windowItems = [sorted[i]!];
    for (let j = i + 1; j < sorted.length; j++) {
      if (itemSec(sorted[j]!) <= windowEnd) {
        windowItems.push(sorted[j]!);
      } else {
        break;
      }
    }

    const n = windowItems.length;
    if (n < 2) continue;

    // Downsample to cap O(n²) cost
    let samples = windowItems;
    if (n > MAX_BRUSH_SAMPLE) {
      const step = Math.floor(n / MAX_BRUSH_SAMPLE);
      samples = windowItems.filter((_, idx) => idx % step === 0);
    }

    const sn = samples.length;
    if (sn < 2) continue;

    let totalPairs = 0;
    let similarPairs = 0;
    for (let a = 0; a < sn; a++) {
      for (let b = a + 1; b < sn; b++) {
        const sim = lcsSimilarity(samples[a]!.text!, samples[b]!.text!);
        totalPairs++;
        if (sim >= brushSimilarityThreshold) similarPairs++;
      }
    }

    const ratio = similarPairs / totalPairs;
    if (ratio >= 0.3) {
      const start = anchor;
      const end = itemSec(windowItems[windowItems.length - 1]!);
      rawWindows.push([start, end]);
    }
  }

  // Merge overlapping windows (0 gap — brushing is by nature clustered)
  return mergeTimeWindows(rawWindows, 0);
}

// ---------------------------------------------------------------------------
// Merge & deduplicate
// ---------------------------------------------------------------------------

/**
 * Merge overlapping TimeWindows (allowing a gap of `mergeGapSec`),
 * then filter by min/max duration.
 *
 * - Sorting & merging: see `mergeTimeWindows()`.
 * - Windows shorter than `minWindowDuration` are dropped.
 * - Windows longer than `maxWindowDuration` are clipped to center.
 */
export function mergeAndDeduplicate(
  windows: TimeWindow[],
  config: AutoClipSignalConfig,
): TimeWindow[] {
  if (windows.length === 0) return [];

  const { mergeGapSec, minWindowDuration, maxWindowDuration } = config;

  // Merge with gap tolerance
  const merged = mergeTimeWindows(windows, mergeGapSec);

  const result: TimeWindow[] = [];

  for (const w of merged) {
    let start = w[0];
    let end = w[1];
    const dur = end - start;

    // Drop too-short windows
    if (dur < minWindowDuration) continue;

    // Clip too-long windows to center
    if (dur > maxWindowDuration) {
      const center = (start + end) / 2;
      start = center - maxWindowDuration / 2;
      end = center + maxWindowDuration / 2;
    }

    result.push([start, end]);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run all four signal detectors, merge results, and build `CandidateWindow`
 * objects with computed statistics.
 */
export function detectSignals(
  stats: DanmuStats,
  config: AutoClipSignalConfig,
): CandidateWindow[] {
  const { danmu, sc, gift } = stats;
  const duration = stats.duration;

  // 1. Run individual signal detectors
  const densityWindows = detectDanmakuDensityPeaks(danmu, duration, config);
  const scWindows = detectSCBursts(sc, config);
  const giftWindows = detectGiftBursts(gift, config);
  const brushWindows = detectBrushStorms(danmu, config);

  // 2. Collect all windows with their signal source labels
  interface LabeledWindow {
    window: TimeWindow;
    source: string;
  }

  const allLabeled: LabeledWindow[] = [
    ...densityWindows.map((w) => ({ window: w, source: "density" })),
    ...scWindows.map((w) => ({ window: w, source: "sc" })),
    ...giftWindows.map((w) => ({ window: w, source: "gift" })),
    ...brushWindows.map((w) => ({ window: w, source: "brush" })),
  ];

  if (allLabeled.length === 0) return [];

  // 3. Merge all windows
  const mergedWindows = mergeAndDeduplicate(
    allLabeled.map((lw) => lw.window),
    config,
  );

  // 4. For each merged window, determine signal sources and compute stats
  const candidates: CandidateWindow[] = [];

  for (const [start, end] of mergedWindows) {
    // Determine which signal sources contributed to this window
    const signalSources: string[] = [];
    for (const { window: sw, source } of allLabeled) {
      if (source === "density" && !signalSources.includes("danmakuDensity")) {
        if (sw[0] <= end && sw[1] >= start) signalSources.push("danmakuDensity");
      }
      if (source === "sc" && !signalSources.includes("scBurst")) {
        if (sw[0] <= end && sw[1] >= start) signalSources.push("scBurst");
      }
      if (source === "gift" && !signalSources.includes("giftBurst")) {
        if (sw[0] <= end && sw[1] >= start) signalSources.push("giftBurst");
      }
      if (source === "brush" && !signalSources.includes("brushStorm")) {
        if (sw[0] <= end && sw[1] >= start) signalSources.push("brushStorm");
      }
    }

    // Collect items within the window
    const windowDanmu = danmu.filter((d) => {
      const s = itemSec(d);
      return s >= start && s <= end;
    });
    const windowSc = sc.filter((d) => {
      const s = itemSec(d);
      return s >= start && s <= end;
    });
    const windowGift = gift.filter((d) => {
      const s = itemSec(d);
      return s >= start && s <= end;
    });

    // Count unique users
    const userSet = new Set<string>();
    for (const d of windowDanmu) {
      if (d.user) userSet.add(d.user);
    }
    for (const d of windowSc) {
      if (d.user) userSet.add(d.user);
    }
    for (const d of windowGift) {
      if (d.user) userSet.add(d.user);
    }

    const dur = end - start;
    const danmakuCount = windowDanmu.length;
    const scCount = windowSc.length;
    const scTotal = windowSc.reduce((sum, s) => sum + (s.gift_price ?? 0), 0);
    const giftCount = windowGift.length;

    // Brush frequency: proportion of danmaku text pairs that are similar (downsampled)
    let brushFrequency = 0;
    const texts = windowDanmu
      .filter((d) => d.text && d.text.trim().length > 0)
      .map((d) => d.text!);
    let sampledTexts = texts;
    if (texts.length > MAX_BRUSH_FREQ_SAMPLE) {
      const step = Math.floor(texts.length / MAX_BRUSH_FREQ_SAMPLE);
      sampledTexts = texts.filter((_, idx) => idx % step === 0);
    }
    if (sampledTexts.length >= 2) {
      let totalPairs = 0;
      let similarPairs = 0;
      for (let a = 0; a < sampledTexts.length; a++) {
        for (let b = a + 1; b < sampledTexts.length; b++) {
          if (lcsSimilarity(sampledTexts[a]!, sampledTexts[b]!) >= config.brushSimilarityThreshold) {
            similarPairs++;
          }
          totalPairs++;
        }
      }
      brushFrequency = totalPairs > 0 ? similarPairs / totalPairs : 0;
    }

    // Build danmaku samples (take first N distinct texts)
    const seenTexts = new Set<string>();
    const danmakuSample: DanmuSample[] = [];
    for (const d of windowDanmu) {
      if (danmakuSample.length >= 20) break;
      const txt = d.text ?? "";
      if (seenTexts.has(txt)) continue;
      seenTexts.add(txt);
      danmakuSample.push({
        timeOffset: itemSec(d) - stats.videoStartTime,
        text: txt,
        user: d.user,
      });
    }

    // Build SC summary
    const scSummary: SCSummary[] = windowSc.map((s) => ({
      user: s.user ?? "unknown",
      amount: s.gift_price ?? 0,
      message: s.text ?? "",
    }));

    candidates.push({
      timeRange: [start, end],
      signalSources,
      stats: {
        danmakuCount,
        danmakuDensity: dur > 0 ? danmakuCount / dur : 0,
        scTotal,
        scCount,
        giftCount,
        uniqueUsers: userSet.size,
        brushFrequency,
      },
      danmakuSample,
      scSummary,
    });
  }

  return candidates;
}
