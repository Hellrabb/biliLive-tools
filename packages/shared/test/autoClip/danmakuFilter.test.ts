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
