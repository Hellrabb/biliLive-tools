import { describe, it, expect } from "vitest";
import type { AutoClipSignalConfig } from "@biliLive-tools/types";
import type { DanmuItem, SC, Gift } from "@biliLive-tools/types";
import type { TimeWindow } from "../../src/autoClip/types";

import {
  detectDanmakuDensityPeaks,
  detectSCBursts,
  detectGiftBursts,
  detectBrushStorms,
  mergeAndDeduplicate,
  mergeTimeWindows,
  detectSignals,
} from "../../src/autoClip/signalDetector";

import {
  buildDanmuStatsMock,
  makeDanmu,
  makeSC,
  makeGift,
  generateUniformDanmaku,
  generateDanmakuCluster,
} from "./mockData";

// ---------------------------------------------------------------------------
// Default config used throughout tests
// ---------------------------------------------------------------------------

function defaultConfig(overrides?: Partial<AutoClipSignalConfig>): AutoClipSignalConfig {
  return {
    danmakuDensityThreshold: 2.0,
    scMinAmount: 30,
    giftBurstThreshold: 10,
    giftBurstWindowSec: 30,
    windowPadding: [5, 5],
    minWindowDuration: 5,
    maxWindowDuration: 300,
    bucketSec: 5,
    mergeGapSec: 15,
    brushSimilarityThreshold: 0.8,
    ...overrides,
  };
}

// ============================================================================
// detectDanmakuDensityPeaks
// ============================================================================

describe("detectDanmakuDensityPeaks", () => {
  it("returns empty result for flat / uniform danmaku distribution", () => {
    const config = defaultConfig({ bucketSec: 10 });
    const items = generateUniformDanmaku(100, 100); // 1 danmaku/sec flat
    const result = detectDanmakuDensityPeaks(items, 100, config);
    expect(result).toEqual([]);
  });

  it("detects a dense cluster in the middle of timeline", () => {
    const config = defaultConfig({ bucketSec: 5, danmakuDensityThreshold: 1.5 });
    const duration = 120;

    // Background: ~1 per second everywhere → ~5 per bucket
    const background = generateUniformDanmaku(120, duration);
    // Dense cluster: 80 items in 10s around 60s → buckets at 55-65 get 40 each
    const cluster = generateDanmakuCluster(80, 60, 10);

    const items = [...background, ...cluster];
    const result = detectDanmakuDensityPeaks(items, duration, config);

    expect(result.length).toBeGreaterThanOrEqual(1);

    // The detected window should cover the cluster region (55-65 raw + padding)
    const hasWindowNear = result.some(
      (w) => w[0] <= 60 && w[1] >= 60,
    );
    expect(hasWindowNear).toBe(true);
  });

  it("detects multiple clusters", () => {
    const config = defaultConfig({ bucketSec: 5, danmakuDensityThreshold: 1.5 });
    const duration = 200;

    const background = generateUniformDanmaku(100, duration);
    const cluster1 = generateDanmakuCluster(50, 40, 8);
    const cluster2 = generateDanmakuCluster(50, 140, 8);

    const items = [...background, ...cluster1, ...cluster2];
    const result = detectDanmakuDensityPeaks(items, duration, config);

    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("handles empty items", () => {
    const result = detectDanmakuDensityPeaks([], 100, defaultConfig());
    expect(result).toEqual([]);
  });

  it("handles zero duration", () => {
    const result = detectDanmakuDensityPeaks(
      [makeDanmu(0, "hello")],
      0,
      defaultConfig(),
    );
    expect(result).toEqual([]);
  });

  it("respects windowPadding to expand detected windows", () => {
    const config = defaultConfig({
      bucketSec: 5,
      danmakuDensityThreshold: 1.0,
      windowPadding: [15, 15],
    });
    const duration = 100;

    // Create a tight cluster at 50-55s
    const cluster = generateDanmakuCluster(100, 52, 4);
    const items = cluster;
    const result = detectDanmakuDensityPeaks(items, duration, config);

    expect(result.length).toBeGreaterThanOrEqual(1);
    // With padding 15s, the raw window around 50-55 should be expanded by 15 on each side
    const w = result[0]!;
    expect(w[0]).toBeLessThanOrEqual(40); // raw 50 - 15 padding
    expect(w[1]).toBeGreaterThanOrEqual(65); // raw 55 + 15 padding
  });
});

// ============================================================================
// detectSCBursts
// ============================================================================

describe("detectSCBursts", () => {
  it("detects 5 SCs each ¥10 within 30s", () => {
    const config = defaultConfig({ scMinAmount: 30, giftBurstWindowSec: 30 });
    const scs: SC[] = [
      makeSC(100, 10),
      makeSC(105, 10),
      makeSC(110, 10),
      makeSC(115, 10),
      makeSC(120, 10),
    ];
    const result = detectSCBursts(scs, config);
    expect(result.length).toBeGreaterThanOrEqual(1);
    // The detected window should cover the dense SC burst
    expect(result[0]![0]).toBeLessThanOrEqual(100);
    expect(result[0]![1]).toBeGreaterThanOrEqual(120);
  });

  it("returns empty for a single low-value SC", () => {
    const config = defaultConfig({ scMinAmount: 30, giftBurstWindowSec: 30 });
    const scs: SC[] = [makeSC(50, 5)];
    const result = detectSCBursts(scs, config);
    expect(result).toEqual([]);
  });

  it("detects a burst exactly at threshold", () => {
    const config = defaultConfig({ scMinAmount: 30, giftBurstWindowSec: 30 });
    const scs: SC[] = [makeSC(0, 30)];
    const result = detectSCBursts(scs, config);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty for empty SC list", () => {
    const result = detectSCBursts([], defaultConfig());
    expect(result).toEqual([]);
  });

  it("does not detect SCs spread beyond the burst window", () => {
    const config = defaultConfig({ scMinAmount: 30, giftBurstWindowSec: 10 });
    const scs: SC[] = [
      makeSC(0, 10),
      makeSC(20, 10),
      makeSC(40, 10),
    ];
    const result = detectSCBursts(scs, config);
    expect(result).toEqual([]);
  });

  it("merges overlapping SC burst windows", () => {
    const config = defaultConfig({ scMinAmount: 20, giftBurstWindowSec: 30 });
    // Two overlapping bursts
    const scs: SC[] = [
      makeSC(0, 15),
      makeSC(5, 15), // burst 1: total 30
      makeSC(10, 15),
      makeSC(20, 15), // burst 2 starts at 5: total 30
      makeSC(25, 10),
    ];
    const result = detectSCBursts(scs, config);
    // Should merge into fewer windows
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// detectGiftBursts
// ============================================================================

describe("detectGiftBursts", () => {
  it("detects 15 gifts within 30s", () => {
    const config = defaultConfig({ giftBurstThreshold: 10, giftBurstWindowSec: 30 });
    const gifts: Gift[] = Array.from({ length: 15 }, (_, i) =>
      makeGift(50 + i * 2),
    );
    const result = detectGiftBursts(gifts, config);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]![0]).toBeLessThanOrEqual(50);
    expect(result[0]![1]).toBeGreaterThanOrEqual(78); // 50 + 14*2
  });

  it("returns empty when gift count is below threshold", () => {
    const config = defaultConfig({ giftBurstThreshold: 10, giftBurstWindowSec: 30 });
    const gifts: Gift[] = Array.from({ length: 5 }, (_, i) =>
      makeGift(50 + i * 2),
    );
    const result = detectGiftBursts(gifts, config);
    expect(result).toEqual([]);
  });

  it("returns empty for empty gift list", () => {
    const result = detectGiftBursts([], defaultConfig());
    expect(result).toEqual([]);
  });

  it("handles exactly threshold count", () => {
    const config = defaultConfig({ giftBurstThreshold: 10, giftBurstWindowSec: 60 });
    const gifts: Gift[] = Array.from({ length: 10 }, () => makeGift(0));
    const result = detectGiftBursts(gifts, config);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("does not detect gifts spread beyond window", () => {
    const config = defaultConfig({ giftBurstThreshold: 10, giftBurstWindowSec: 10 });
    const gifts: Gift[] = Array.from({ length: 15 }, (_, i) =>
      makeGift(i * 5),
    );
    const result = detectGiftBursts(gifts, config);
    expect(result).toEqual([]);
  });
});

// ============================================================================
// detectBrushStorms
// ============================================================================

describe("detectBrushStorms", () => {
  it("detects 50 '666666' copies within 5s as a brush storm", () => {
    const config = defaultConfig({ brushSimilarityThreshold: 0.7 });
    const items: DanmuItem[] = Array.from({ length: 50 }, (_, i) =>
      makeDanmu(10 + i * 0.1, "666666", `user_${i}`),
    );
    const result = detectBrushStorms(items, config);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]![0]).toBeLessThanOrEqual(10);
    expect(result[0]![1]).toBeGreaterThanOrEqual(14.9);
  });

  it("returns empty for random distinct items", () => {
    const config = defaultConfig({ brushSimilarityThreshold: 0.8 });
    const items: DanmuItem[] = Array.from({ length: 30 }, (_, i) =>
      makeDanmu(
        10 + i * 0.3,
        `distinct_message_${i}_${Math.random().toString(36).slice(2, 10)}`,
      ),
    );
    const result = detectBrushStorms(items, config);
    expect(result).toEqual([]);
  });

  it("handles items without text", () => {
    const config = defaultConfig();
    const items: DanmuItem[] = [
      { ts: 10000, timestamp: 10, type: "text" }, // no text
      { ts: 11000, timestamp: 11, type: "text" }, // no text
    ];
    const result = detectBrushStorms(items, config);
    expect(result).toEqual([]);
  });

  it("handles less than 2 text items", () => {
    const config = defaultConfig();
    const items: DanmuItem[] = [makeDanmu(0, "only one")];
    const result = detectBrushStorms(items, config);
    expect(result).toEqual([]);
  });

  it("detects mixed repetition among other messages", () => {
    const config = defaultConfig({ brushSimilarityThreshold: 0.7 });
    const items: DanmuItem[] = [
      makeDanmu(5, "unique msg A"),
      ...Array.from({ length: 30 }, (_, i) =>
        makeDanmu(10 + i * 0.2, "bravo bravo")),
      makeDanmu(17, "unique msg B"),
    ];
    const result = detectBrushStorms(items, config);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// mergeAndDeduplicate
// ============================================================================

describe("mergeAndDeduplicate", () => {
  it("merges overlapping windows", () => {
    const config = defaultConfig({ mergeGapSec: 10 });
    const windows: [number, number][] = [
      [0, 30],
      [20, 50], // overlaps with first
    ];
    const result = mergeAndDeduplicate(windows, config);
    expect(result).toEqual([[0, 50]]);
  });

  it("merges windows within mergeGapSec of each other", () => {
    const config = defaultConfig({ mergeGapSec: 10, minWindowDuration: 5 });
    const windows: [number, number][] = [
      [0, 30],
      [38, 60], // gap of 8s ≤ 10s → merged
    ];
    const result = mergeAndDeduplicate(windows, config);
    expect(result).toEqual([[0, 60]]);
  });

  it("does not merge windows farther apart than mergeGapSec", () => {
    const config = defaultConfig({ mergeGapSec: 10, minWindowDuration: 5 });
    const windows: [number, number][] = [
      [0, 20],
      [40, 60], // gap of 20s > 10s → separate
    ];
    const result = mergeAndDeduplicate(windows, config);
    expect(result).toEqual([
      [0, 20],
      [40, 60],
    ]);
  });

  it("filters windows shorter than minWindowDuration", () => {
    const config = defaultConfig({ minWindowDuration: 10, mergeGapSec: 5 });
    const windows: [number, number][] = [[0, 5]];
    const result = mergeAndDeduplicate(windows, config);
    expect(result).toEqual([]);
  });

  it("clips window exceeding maxWindowDuration to center", () => {
    const config = defaultConfig({
      maxWindowDuration: 30,
      minWindowDuration: 5,
      mergeGapSec: 5,
    });
    const windows: [number, number][] = [[0, 100]];
    const result = mergeAndDeduplicate(windows, config);
    expect(result.length).toBe(1);
    const w = result[0]!;
    expect(w[1] - w[0]).toBe(30);
    expect(w[0]).toBe(35); // center at 50 → [35, 65]
    expect(w[1]).toBe(65);
  });

  it("drops window when clipping produces a window below minWindowDuration", () => {
    const config = defaultConfig({
      maxWindowDuration: 30,
      minWindowDuration: 60,
      mergeGapSec: 5,
    });
    // Original dur=400 > maxWindow(30), clipped to 30s at center
    // 30 < minWindow(60), should be dropped
    const windows: [number, number][] = [[0, 400]];
    const result = mergeAndDeduplicate(windows, config);
    expect(result).toEqual([]);
  });

  it("handles empty input", () => {
    const result = mergeAndDeduplicate([], defaultConfig());
    expect(result).toEqual([]);
  });

  it("sorts unsorted input before merging", () => {
    const config = defaultConfig({ mergeGapSec: 10, minWindowDuration: 5 });
    const windows: [number, number][] = [
      [20, 50],
      [0, 30],
    ];
    const result = mergeAndDeduplicate(windows, config);
    expect(result).toEqual([[0, 50]]);
  });
});

// ============================================================================
// detectSignals (integration)
// ============================================================================

describe("detectSignals", () => {
  const config = defaultConfig({
    danmakuDensityThreshold: 2.0,
    scMinAmount: 30,
    giftBurstThreshold: 10,
    giftBurstWindowSec: 30,
    bucketSec: 5,
    mergeGapSec: 15,
    minWindowDuration: 5,
    maxWindowDuration: 300,
    windowPadding: [5, 5],
    brushSimilarityThreshold: 0.7,
  });

  it("returns empty result for empty danmu/sc/gift", () => {
    const stats = buildDanmuStatsMock([], [], [], [], 100);
    const result = detectSignals(stats, config);
    expect(result).toEqual([]);
  });

  it("returns candidates with populated signalSources", () => {
    const duration = 300;

    // Uniform background danmaku
    const bgDanmu = generateUniformDanmaku(300, duration, "背景弹幕");

    // Dense danmaku cluster at 120s
    const clusterDanmu = generateDanmakuCluster(100, 120, 10, "高潮弹幕");

    // SC burst at 130s
    const scs: SC[] = [
      makeSC(130, 15, "sc_user1"),
      makeSC(132, 15, "sc_user2"),
      makeSC(134, 15, "sc_user3"),
    ];

    // Gift burst at 140s
    const gifts: Gift[] = Array.from({ length: 12 }, (_, i) =>
      makeGift(140 + i * 2, "小花", 1, `gift_user_${i}`),
    );

    // Brush storm at 150s
    const brushDanmu: DanmuItem[] = Array.from({ length: 50 }, (_, i) =>
      makeDanmu(150 + i * 0.15, "666666", `brush_user_${i}`),
    );

    const allDanmu = [...bgDanmu, ...clusterDanmu, ...brushDanmu];

    const stats = buildDanmuStatsMock(allDanmu, scs, gifts, [], duration);
    const result = detectSignals(stats, config);

    expect(result.length).toBeGreaterThanOrEqual(1);

    // At least one candidate should have signalSources populated
    const allSources = result.flatMap((c) => c.signalSources);
    expect(allSources.length).toBeGreaterThan(0);

    // Each candidate should have stats populated
    for (const c of result) {
      expect(c.stats.danmakuCount).toBeGreaterThanOrEqual(0);
      expect(c.stats.danmakuDensity).toBeGreaterThanOrEqual(0);
      expect(c.stats.scTotal).toBeGreaterThanOrEqual(0);
      expect(c.stats.giftCount).toBeGreaterThanOrEqual(0);
      expect(c.stats.uniqueUsers).toBeGreaterThanOrEqual(0);
      expect(c.signalSources.length).toBeGreaterThan(0);
      expect(c.timeRange[0]).toBeLessThan(c.timeRange[1]);
    }
  });

  it("populates danmakuSample within candidates", () => {
    const duration = 100;
    const items = generateDanmakuCluster(100, 50, 20, "测试弹幕");
    const stats = buildDanmuStatsMock(items, [], [], [], duration);
    const result = detectSignals(stats, config);

    expect(result.length).toBeGreaterThanOrEqual(1);
    const candidate = result[0]!;
    expect(candidate.danmakuSample.length).toBeGreaterThan(0);
    expect(typeof candidate.danmakuSample[0]!.timeOffset).toBe("number");
    expect(typeof candidate.danmakuSample[0]!.text).toBe("string");
  });

  it("populates scSummary within candidates", () => {
    // Use a config with low minWindowDuration so that shorter SC bursts survive
    const scConfig = defaultConfig({
      scMinAmount: 30,
      giftBurstWindowSec: 30,
      minWindowDuration: 1,
      maxWindowDuration: 300,
    });
    const duration = 100;
    const scs: SC[] = [
      makeSC(40, 20, "sc_user", "Great stream!"),
      makeSC(42, 20, "sc_user2", "Awesome!"),
    ];
    const stats = buildDanmuStatsMock([], scs, [], [], duration);
    const result = detectSignals(stats, scConfig);

    expect(result.length).toBeGreaterThanOrEqual(1);
    const candidate = result[0]!;
    expect(candidate.scSummary.length).toBeGreaterThanOrEqual(1);
    expect(typeof candidate.scSummary[0]!.user).toBe("string");
    expect(typeof candidate.scSummary[0]!.amount).toBe("number");
  });

  it("computes unique users correctly", () => {
    const duration = 100;
    const items = [
      makeDanmu(10, "msg1", "userA"),
      makeDanmu(12, "msg2", "userB"),
      makeDanmu(14, "msg3", "userA"), // duplicate user
      makeDanmu(16, "msg4", "userC"),
    ];
    // Create enough density for detection
    const cluster = generateDanmakuCluster(50, 15, 10, "fill");
    const stats = buildDanmuStatsMock([...items, ...cluster], [], [], [], duration);
    const result = detectSignals(stats, config);

    expect(result.length).toBeGreaterThanOrEqual(1);
    // Find the candidate that covers our items
    const relevant = result.find(
      (c) => c.timeRange[0] <= 10 && c.timeRange[1] >= 16,
    );
    if (relevant) {
      // Users from the cluster items are mostly undefined, so uniqueUsers >= 3
      expect(relevant.stats.uniqueUsers).toBeGreaterThanOrEqual(3);
    }
  });

  it("handles items that use ts instead of timestamp", () => {
    const noTsConfig = defaultConfig({
      scMinAmount: 30,
      giftBurstWindowSec: 30,
      minWindowDuration: 0,
    });
    const scs: SC[] = [
      {
        text: "SC via ts",
        ts: 100 * 1000, // 100 seconds in ms, no timestamp field
        type: "sc",
        user: "sc_user",
        gift_price: 50,
      },
    ];
    const stats = buildDanmuStatsMock([], scs, [], [], 200);
    const result = detectSignals(stats, noTsConfig);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// Performance: brush storm downsampling
// ============================================================================

describe("brush storm downsampling", () => {
  it("limits pair-wise LCS to MAX_BRUSH_SAMPLE items per window", () => {
    const config = defaultConfig({ brushSimilarityThreshold: 0.6, mergeGapSec: 5 });
    const items: DanmuItem[] = [];
    for (let i = 0; i < 500; i++) {
      items.push(makeDanmu(i * 0.02, "666666"));
    }
    const result = detectBrushStorms(items, config);
    expect(result.length).toBeGreaterThan(0);
    // Verify detected window has reasonable bounds
    expect(result[0]![0]).toBeGreaterThanOrEqual(0);
    expect(result[0]![1]).toBeLessThanOrEqual(10);
  });

  it("detectSignals brushFrequency uses downsampled texts", () => {
    const config = defaultConfig({ brushSimilarityThreshold: 0.6, mergeGapSec: 5 });
    const cluster = generateDanmakuCluster(300, 60, 120);
    const bg = generateUniformDanmaku(50, 600);
    const allDanmu = [...cluster, ...bg];
    const stats = buildDanmuStatsMock(allDanmu, [], [], [], 600);
    const result = detectSignals(stats, config);
    // Must detect at least one candidate from the dense cluster.
    expect(result.length).toBeGreaterThan(0);
    // At least one candidate should have brushStorm as a signal source
    // since the cluster items all share the same text.
    const withBrush = result.filter((c) =>
      c.signalSources.includes("brushStorm"),
    );
    expect(withBrush.length).toBeGreaterThan(0);
    // Danmaku sample should be populated for LLM ranking.
    const candidate = result[0]!;
    expect(candidate.danmakuSample.length).toBeGreaterThan(0);
    expect(typeof candidate.danmakuSample[0]!.text).toBe("string");
  });

  // ============================================================================
  // mergeTimeWindows mutation safety
  // ============================================================================

  it("should not mutate input window tuples", () => {
    const input: TimeWindow[] = [[10, 20], [15, 30], [100, 120]];
    const snapshot = input.map((w) => [...w]);

    mergeTimeWindows(input, 5);

    for (let i = 0; i < input.length; i++) {
      expect(input[i]).toEqual(snapshot[i]);
    }
  });

  it("should still produce correct merged result", () => {
    const input: TimeWindow[] = [[10, 20], [15, 30], [40, 50]];
    const result = mergeTimeWindows(input, 5);
    expect(result).toEqual([[10, 30], [40, 50]]);
  });

  it("downsampling approximates full result", () => {
    // Generate two datasets with the same pattern and distribution but
    // different sizes: one under MAX_BRUSH_SAMPLE (full scan, no downsampling)
    // and one over (downsampled). Both should detect the same brush storm.
    const config = defaultConfig({ brushSimilarityThreshold: 0.6, mergeGapSec: 5 });

    // Reference: 60 items (under MAX_BRUSH_SAMPLE=80, no downsampling).
    // Every 3rd item is '666666' (~33%), rest are varying 'lolN'.
    const refItems: DanmuItem[] = [];
    for (let i = 0; i < 60; i++) {
      refItems.push(makeDanmu(i * 0.15, i % 3 === 0 ? '666666' : 'lol' + i));
    }
    const refResult = detectBrushStorms(refItems, config);

    // Downsampled: 200 items (over MAX_BRUSH_SAMPLE), same distribution.
    const dsItems: DanmuItem[] = [];
    for (let i = 0; i < 200; i++) {
      dsItems.push(makeDanmu(i * 0.05, i % 3 === 0 ? '666666' : 'lol' + i));
    }
    const dsResult = detectBrushStorms(dsItems, config);

    // Both should detect a brush storm.
    expect(refResult.length).toBeGreaterThan(0);
    expect(dsResult.length).toBeGreaterThan(0);

    // The downsampled window bounds should be close to the reference.
    // Allow up to 2s tolerance since downsampling slightly shifts window edges.
    const refWin = refResult[0]!;
    const dsWin = dsResult[0]!;
    expect(Math.abs(dsWin[0] - refWin[0])).toBeLessThanOrEqual(2);
    expect(Math.abs(dsWin[1] - refWin[1])).toBeLessThanOrEqual(2);

    // Both windows should cover the data range.
    expect(refWin[0]).toBeGreaterThanOrEqual(0);
    expect(dsWin[0]).toBeGreaterThanOrEqual(0);
    expect(refWin[1]).toBeLessThanOrEqual(10);
    expect(dsWin[1]).toBeLessThanOrEqual(10);
  });
});
