import { describe, it, expect } from "vitest";
import { detectSuspicious } from "../../src/autoClip/danmakuFilter.js";

function makeDanmu(text: string, count: number): Array<{ ts: number; text: string }> {
  const items: Array<{ ts: number; text: string }> = [];
  for (let i = 0; i < count; i++) {
    items.push({ ts: i * 1000, text });
  }
  return items;
}

describe("detectSuspicious", () => {
  it("groups exact-match danmaku above minOccurrence", () => {
    const danmu = [
      ...makeDanmu("点点关注右上角抽钻石", 8),
      ...makeDanmu("主播牛逼", 3),
      ...makeDanmu("666", 2),
    ];
    const result = detectSuspicious(danmu, { minOccurrence: 5, topK: 10 });
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe("点点关注右上角抽钻石");
    expect(result[0]!.count).toBe(8);
    expect(result[0]!.similarity).toBe(1.0);
  });

  it("filters out short texts (< 3 chars)", () => {
    const danmu = [
      ...makeDanmu("哈", 10),
      ...makeDanmu("6", 10),
    ];
    const result = detectSuspicious(danmu, { minOccurrence: 5, topK: 10 });
    expect(result).toHaveLength(0);
  });

  it("clusters similar texts by Dice coefficient", () => {
    const danmu = [
      ...makeDanmu("关注右上角抽奖呀", 6),
      ...makeDanmu("关注右上角抽手机", 5),
      ...makeDanmu("关注右上角抽大奖", 4),
    ];
    const result = detectSuspicious(danmu, { minOccurrence: 3, topK: 10 });
    const cluster = result.find((r: { text: string }) => r.text === "关注右上角抽奖呀");
    expect(cluster).toBeDefined();
    expect(cluster!.count).toBeGreaterThanOrEqual(6);
    expect(cluster!.similarity).toBeLessThan(1.0);
  });

  it("returns empty array for normal danmaku", () => {
    const danmu = [
      ...makeDanmu("哈哈哈笑死我了", 2),
      ...makeDanmu("主播好厉害", 2),
      ...makeDanmu("这波天秀", 1),
      ...makeDanmu("来了来了", 2),
      ...makeDanmu("加油加油", 2),
    ];
    const result = detectSuspicious(danmu, { minOccurrence: 5, topK: 10 });
    expect(result).toHaveLength(0);
  });

  it("respects topK limit", () => {
    const danmu = [
      ...makeDanmu("A".repeat(10), 10),
      ...makeDanmu("B".repeat(10), 10),
      ...makeDanmu("C".repeat(10), 10),
      ...makeDanmu("D".repeat(10), 10),
    ];
    const result = detectSuspicious(danmu, { minOccurrence: 5, topK: 2 });
    expect(result).toHaveLength(2);
  });

  it("downsamples large input without losing high-frequency items", () => {
    const danmu: Array<{ ts: number; text: string }> = [];
    for (let i = 0; i < 2000; i++) {
      danmu.push({ ts: i * 10, text: `unique_${i}` });
    }
    for (let i = 0; i < 30; i++) {
      danmu.push({ ts: (2000 + i) * 10, text: "关注主播抽手机" });
    }
    const result = detectSuspicious(danmu, { minOccurrence: 5, topK: 10 });
    const spam = result.find((r: { text: string }) => r.text === "关注主播抽手机");
    expect(spam).toBeDefined();
    expect(spam!.count).toBeGreaterThanOrEqual(20);
  });
});

import { applyFilter } from "../../src/autoClip/danmakuFilter.js";
import type { DanmakuFilterConfig } from "@biliLive-tools/types";

describe("applyFilter", () => {
  const danmu = [
    { text: "点点关注右上角抽钻石", ts: 1000 },
    { text: "主播好帅", ts: 2000 },
    { text: "关注主播不迷路抽奖咯", ts: 3000 },
    { text: "哈哈哈哈笑死了", ts: 4000 },
    { text: "右上角抽手机啦", ts: 5000 },
  ];

  const config: DanmakuFilterConfig = {
    enabled: true,
    autoDetectEnabled: true,
    rules: [
      { id: "r1", pattern: "点点关注右上角抽钻石", mode: "exact", source: "auto", enabled: true, createdAt: 0 },
      { id: "r2", pattern: "抽", mode: "contains", source: "auto", enabled: true, createdAt: 0 },
      { id: "r3", pattern: "右上角抽.*", mode: "regex", source: "manual", enabled: true, createdAt: 0 },
      { id: "r4", pattern: "disabled_rule", mode: "contains", source: "manual", enabled: false, createdAt: 0 },
    ],
  };

  it("filters by exact match", () => {
    const cfg: DanmakuFilterConfig = {
      enabled: true,
      autoDetectEnabled: true,
      rules: [config.rules[0]!],
    };
    const result = applyFilter(danmu, cfg);
    expect(result.filtered).toHaveLength(4);
    expect(result.removed).toBe(1);
  });

  it("filters by contains", () => {
    const cfg: DanmakuFilterConfig = {
      enabled: true,
      autoDetectEnabled: true,
      rules: [config.rules[1]!],
    };
    const result = applyFilter(danmu, cfg);
    expect(result.removed).toBeGreaterThanOrEqual(2);
  });

  it("filters by regex", () => {
    const cfg: DanmakuFilterConfig = {
      enabled: true,
      autoDetectEnabled: true,
      rules: [config.rules[2]!],
    };
    const result = applyFilter(danmu, cfg);
    const filteredTexts = result.filtered.map((d: { text: string }) => d.text);
    expect(filteredTexts).not.toContain("右上角抽手机啦");
  });

  it("does not apply disabled rules", () => {
    const cfg: DanmakuFilterConfig = {
      enabled: true,
      autoDetectEnabled: true,
      rules: [config.rules[3]!],
    };
    const result = applyFilter(danmu, cfg);
    expect(result.removed).toBe(0);
    expect(result.filtered).toHaveLength(danmu.length);
  });

  it("skips filtering when config.enabled is false", () => {
    const cfg: DanmakuFilterConfig = { ...config, enabled: false };
    const result = applyFilter(danmu, cfg);
    expect(result.filtered).toEqual(danmu);
    expect(result.removed).toBe(0);
  });

  it("returns correct breakdown stats", () => {
    const result = applyFilter(danmu, config);
    const totalRemoved = result.breakdown.reduce((sum: number, b: { removed: number }) => sum + b.removed, 0);
    expect(totalRemoved).toBe(result.removed);
  });

  it("rejects regex patterns over MAX_REGEX_PATTERN_LENGTH", () => {
    const longPattern = "a".repeat(101);
    const danmu = [{ text: "hello" }];
    const config: DanmakuFilterConfig = {
      enabled: true,
      rules: [{ id: "1", pattern: longPattern, mode: "regex", source: "manual", enabled: true, createdAt: 0 }],
    };
    const result = applyFilter(danmu, config);
    expect(result.filtered).toHaveLength(1);
    expect(result.removed).toBe(0);
  });

  it("rejects regex with nested quantifiers (ReDoS guard)", () => {
    const danmu = [{ text: "hello" }];
    const patterns = ["(a+)+", "(a+)*", "([a-z]+)+"];
    for (const p of patterns) {
      const config: DanmakuFilterConfig = {
        enabled: true,
        rules: [{ id: "1", pattern: p, mode: "regex", source: "manual", enabled: true, createdAt: 0 }],
      };
      const result = applyFilter(danmu, config);
      expect(result.filtered).toHaveLength(1);
      expect(result.removed).toBe(0);
    }
  });
});

// ============================================================================
// llmReviewPatterns (M8: batch pagination for large pattern lists)
// ============================================================================

import { llmReviewPatterns } from "../../src/autoClip/danmakuFilter.js";
import type { SuspiciousPattern } from "../../src/autoClip/types.js";
import { vi } from "vitest";

describe("llmReviewPatterns pagination (M8)", () => {
  it("should handle a single pattern without batching", async () => {
    const patterns: SuspiciousPattern[] = [
      { text: "关注主播抽手机", count: 15, similarity: 0.98 },
    ];
    let callCount = 0;
    const sendMessage = async (_prompt: string) => {
      callCount++;
      return JSON.stringify({
        results: [{ index: 1, verdict: "spam", reason: "抽奖广告" }],
      });
    };
    const result = await llmReviewPatterns(patterns, sendMessage);
    expect(callCount).toBe(1);
    expect(result.newRules).toHaveLength(1);
    expect(result.newRules[0]!.pattern).toBe("关注主播抽手机");
  });

  it("should batch large patterns to avoid context overflow", async () => {
    // Create 10 patterns each with ~350 chars → ~3500 total > 3000 threshold
    const patterns: SuspiciousPattern[] = [];
    for (let i = 0; i < 10; i++) {
      patterns.push({
        text: `x`.repeat(350) + `_${i}`,
        count: 20 + i,
        similarity: 0.92,
      });
    }

    const callCounts: number[] = [];
    const sendMessage = async (prompt: string) => {
      callCounts.push(prompt.length);
      // Return results for first few patterns as spam
      const results = patterns.slice(0, 3).map((_, idx) => ({
        index: idx + 1,
        verdict: "spam" as const,
        reason: "广告",
      }));
      return JSON.stringify({ results });
    };

    const result = await llmReviewPatterns(patterns, sendMessage);

    // Should batch into multiple calls (total chars > 3000)
    // Each batch call should be smaller than the threshold
    expect(callCounts.length).toBeGreaterThanOrEqual(1);
    // New rules should be generated from spam verdicts
    expect(result.newRules.length).toBeGreaterThanOrEqual(0);
  });

  it("should merge results from multiple batches", async () => {
    const patterns: SuspiciousPattern[] = [
      { text: "关注主播抽手机", count: 15, similarity: 0.98 },
      { text: "点点关注右上角", count: 12, similarity: 0.95 },
      { text: "哈哈哈哈笑死", count: 8, similarity: 0.3 },
      { text: "主播牛逼666", count: 7, similarity: 0.3 },
    ];

    const sendMessage = async (prompt: string) => {
      const patternCount = (prompt.match(/\d+\.\s"/g) || []).length;
      const results = [];
      for (let i = 0; i < patternCount; i++) {
        results.push({
          index: i + 1,
          verdict: i < 2 ? "spam" : "not_spam",
          reason: i < 2 ? "抽奖广告" : "正常互动",
        });
      }
      return JSON.stringify({ results });
    };

    const result = await llmReviewPatterns(patterns, sendMessage);

    // Should classify all patterns
    expect(result.patterns).toHaveLength(4);
    // First 2 should be spam
    const spamPatterns = result.patterns.filter((p) => p.verdict === "spam");
    expect(spamPatterns).toHaveLength(2);
    // Should generate 2 new rules
    expect(result.newRules).toHaveLength(2);
  });
});
