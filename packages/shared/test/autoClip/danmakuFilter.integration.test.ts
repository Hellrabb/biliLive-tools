import { describe, it, expect } from "vitest";
import { detectSuspicious, applyFilter, llmReviewPatterns } from "../../src/autoClip/danmakuFilter.js";

describe("danmakuFilter integration", () => {
  it("full flow: detect → LLM review → apply", async () => {
    const danmu = [
      ...Array.from({ length: 12 }, (_, i) => ({ text: "点点关注右上角抽钻石", ts: i * 1000 })),
      ...Array.from({ length: 8 }, (_, i) => ({ text: "关注主播抽大奖咯", ts: (12 + i) * 1000 })),
      ...Array.from({ length: 5 }, (_, i) => ({ text: "666", ts: (20 + i) * 1000 })),
      ...Array.from({ length: 3 }, (_, i) => ({ text: "主播好帅啊", ts: (25 + i) * 1000 })),
      ...Array.from({ length: 2 }, (_, i) => ({ text: "来了来了", ts: (28 + i) * 1000 })),
    ];

    // Step 1: detect suspicious patterns
    const patterns = detectSuspicious(danmu, { minOccurrence: 5, topK: 10 });
    expect(patterns.length).toBeGreaterThanOrEqual(1);

    const spamPattern = patterns.find((p) => p.text.includes("抽"));
    expect(spamPattern).toBeDefined();

    // Step 2: LLM review with mock
    const mockSendMessage = async (prompt: string) => {
      const results = patterns.map((p, i) => ({
        index: i + 1,
        verdict: p.text.includes("抽") ? "spam" : "not_spam",
        reason: p.text.includes("抽") ? "抽奖广告" : "正常互动",
      }));
      return JSON.stringify({ results });
    };
    const reviewResult = await llmReviewPatterns(patterns, mockSendMessage);
    expect(reviewResult.newRules.length).toBeGreaterThanOrEqual(1);
    expect(reviewResult.patterns.every((p) => p.verdict === "spam" || p.verdict === "not_spam")).toBe(true);

    // Step 3: apply filter with auto-generated rules
    const filterConfig = {
      enabled: true,
      autoDetectEnabled: true,
      rules: reviewResult.newRules,
    };
    const filterResult = applyFilter(danmu, filterConfig);
    expect(filterResult.removed).toBeGreaterThanOrEqual(12);
    expect(filterResult.filtered.length).toBeLessThan(danmu.length);

    // Verify legitimate danmaku survived
    const filteredTexts = filterResult.filtered.map((d) => d.text);
    expect(filteredTexts).toContain("666");
    expect(filteredTexts).toContain("主播好帅啊");

    // Verify breakdown stats
    expect(filterResult.breakdown.length).toBeGreaterThanOrEqual(1);
    const totalBreakdown = filterResult.breakdown.reduce((sum, b) => sum + b.removed, 0);
    expect(totalBreakdown).toBe(filterResult.removed);
  });

  it("statistical fallback triggers when LLM fails", async () => {
    const danmu = [
      ...Array.from({ length: 12 }, (_, i) => ({ text: "关注主播抽手机啦", ts: i * 1000 })),
      ...Array.from({ length: 5 }, (_, i) => ({ text: "正经弹幕", ts: (12 + i) * 1000 })),
    ];

    const patterns = detectSuspicious(danmu, { minOccurrence: 3, topK: 10 });
    expect(patterns.length).toBeGreaterThanOrEqual(1);

    // LLM that always throws
    const failingSendMessage = async (_prompt: string) => {
      throw new Error("LLM unavailable");
    };
    const result = await llmReviewPatterns(patterns, failingSendMessage);

    // Should use statistical fallback: count >= 10 AND similarity >= 0.9 → spam
    const spamPattern = result.patterns.find((p) => p.text === "关注主播抽手机啦");
    expect(spamPattern).toBeDefined();
    expect(spamPattern!.verdict).toBe("spam");
    expect(result.newRules.length).toBeGreaterThanOrEqual(1);
  });

  it("empty patterns produce empty results", async () => {
    const result = await llmReviewPatterns([], async () => "{}");
    expect(result.patterns).toHaveLength(0);
    expect(result.newRules).toHaveLength(0);
  });
});
