import type { SuspiciousPattern } from "./types.js";

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

  // Optional downsampling for large inputs
  const sample = danmu.length > 5000
    ? danmu.filter((_, i) => i % 3 === 0)
    : danmu;

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
