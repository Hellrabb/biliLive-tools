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
