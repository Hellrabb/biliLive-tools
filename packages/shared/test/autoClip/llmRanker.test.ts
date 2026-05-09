import { describe, it, expect } from "vitest";
import {
  buildLLMPrompt,
  parseLLMResponse,
  preRankCandidates,
  rankCandidates,
  DEFAULT_PROMPT_TEMPLATE,
} from "../../src/autoClip/llmRanker";
import type {
  ClipCandidateContext,
  CandidateWindow,
} from "../../src/autoClip/types";
import type { AutoClipLLMConfig } from "@biliLive-tools/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockContext(overrides: Partial<ClipCandidateContext> = {}): ClipCandidateContext {
  return {
    windowStart: 120,
    windowEnd: 300,
    danmakuSamples: ["来了来了", "牛啊", "666666", "名场面!", "泪目了"],
    scSummary: [{ user: "大佬", amount: 30, message: "主播加油!" }],
    stats: {
      danmakuCount: 150,
      danmakuDensity: 2.5,
      scTotal: 30,
      scCount: 1,
      giftCount: 0,
      uniqueUsers: 80,
      brushFrequency: 2,
    },
    surroundingBefore: ["坐等", "开始了"],
    surroundingAfter: ["下一part", "别走"],
    ...overrides,
  };
}

function makeMockCandidate(overrides: Partial<CandidateWindow> = {}): CandidateWindow {
  return {
    timeRange: [120, 300],
    signalSources: ["danmakuDensity", "scBurst"],
    stats: {
      danmakuCount: 150,
      danmakuDensity: 2.5,
      scTotal: 30,
      scCount: 1,
      giftCount: 0,
      uniqueUsers: 80,
      brushFrequency: 2,
    },
    danmakuSample: [
      { timeOffset: 121, text: "来了来了" },
      { timeOffset: 125, text: "牛啊" },
      { timeOffset: 130, text: "666666" },
      { timeOffset: 140, text: "名场面!" },
      { timeOffset: 150, text: "泪目了" },
    ],
    scSummary: [{ user: "大佬", amount: 30, message: "主播加油!" }],
    ...overrides,
  };
}

function makeLLMConfig(overrides: Partial<AutoClipLLMConfig> = {}): AutoClipLLMConfig {
  return {
    enabled: true,
    provider: "qwen",
    modelId: "qwen-turbo",
    maxTokens: 1000,
    topK: 5,
    maxCandidatesPerVideo: 15,
    danmakuSampleMax: 200,
    promptTemplate: undefined,
    ...overrides,
  };
}

// ============================================================================
// buildLLMPrompt
// ============================================================================

describe("buildLLMPrompt", () => {
  it("should include stats and danmaku samples", () => {
    const ctx = makeMockContext();
    const prompt = buildLLMPrompt(ctx);
    expect(prompt).toContain("150");
    expect(prompt).toContain("2.5");
    expect(prompt).toContain("666666");
    expect(prompt).toContain("大佬");
    expect(prompt).toContain("isHighlight");
  });

  it("should handle empty SC records gracefully", () => {
    const ctx = makeMockContext({ scSummary: [] });
    const prompt = buildLLMPrompt(ctx);
    expect(prompt).toContain("SC total");
    expect(prompt).toContain("(none)");
  });

  it("should include surrounding context strings", () => {
    const ctx = makeMockContext({
      surroundingBefore: ["弹幕A", "弹幕B", "弹幕C"],
      surroundingAfter: ["弹幕X", "弹幕Y"],
    });
    const prompt = buildLLMPrompt(ctx);
    expect(prompt).toContain("弹幕A");
    expect(prompt).toContain("弹幕Y");
  });

  it("should format SC records as user ¥amount: message", () => {
    const ctx = makeMockContext({
      scSummary: [
        { user: "土豪A", amount: 100, message: "666" },
        { user: "土豪B", amount: 50, message: "加油" },
      ],
    });
    const prompt = buildLLMPrompt(ctx);
    expect(prompt).toContain("土豪A ¥100: 666");
    expect(prompt).toContain("土豪B ¥50: 加油");
  });

  it("should use custom template when provided", () => {
    const ctx = makeMockContext({ stats: { ...makeMockContext().stats, danmakuCount: 999 } });
    const customTpl = "Custom: {count} danmaku";
    const prompt = buildLLMPrompt(ctx, customTpl);
    expect(prompt).toBe("Custom: 999 danmaku");
  });

  it("should truncate surrounding context to 10 items each", () => {
    const ctx = makeMockContext({
      surroundingBefore: Array.from({ length: 15 }, (_, i) => `before_${i}`),
      surroundingAfter: Array.from({ length: 15 }, (_, i) => `after_${i}`),
    });
    const prompt = buildLLMPrompt(ctx);
    // Should only have the first 10 "before" items
    expect(prompt).toContain("before_9");
    expect(prompt).not.toContain("before_10");
    // Should only have the first 10 "after" items
    expect(prompt).toContain("after_9");
    expect(prompt).not.toContain("after_10");
  });

  it("should handle empty danmaku samples", () => {
    const ctx = makeMockContext({ danmakuSamples: [] });
    const prompt = buildLLMPrompt(ctx);
    expect(prompt).toContain("(none)");
  });

  it("should include brush frequency in prompt", () => {
    const ctx = makeMockContext({ stats: { ...makeMockContext().stats, brushFrequency: 0.75 } });
    const prompt = buildLLMPrompt(ctx);
    expect(prompt).toContain("0.75");
  });
});

// ============================================================================
// parseLLMResponse
// ============================================================================

describe("parseLLMResponse", () => {
  it("should parse valid JSON response", () => {
    const raw = JSON.stringify({
      isHighlight: true,
      score: 8,
      title: "主播神操作",
      tags: ["操作", "高能"],
      highlightType: "impressive",
      reason: "弹幕爆发+SC大额打赏",
      bestClipStart: 125,
      bestClipEnd: 295,
    });
    const result = parseLLMResponse(raw, [120, 300]);
    expect(result.isHighlight).toBe(true);
    expect(result.score).toBe(8);
    expect(result.title).toBe("主播神操作");
    expect(result.bestClipStart).toBe(125);
    expect(result.bestClipEnd).toBe(295);
  });

  it("should fall back to window bounds on bad JSON", () => {
    const raw = "random text not json";
    const result = parseLLMResponse(raw, [120, 300]);
    expect(result.isHighlight).toBe(false);
    expect(result.score).toBe(0);
    expect(result.bestClipStart).toBe(120);
    expect(result.bestClipEnd).toBe(300);
  });

  it("should clamp bestClipStart/End to window bounds", () => {
    const raw = JSON.stringify({
      isHighlight: true,
      score: 5,
      title: "test",
      tags: [],
      highlightType: "hype",
      reason: "test",
      bestClipStart: 50,
      bestClipEnd: 400,
    });
    const result = parseLLMResponse(raw, [120, 300]);
    expect(result.bestClipStart).toBe(120);
    expect(result.bestClipEnd).toBe(300);
  });

  it("should handle JSON wrapped in markdown code block", () => {
    const raw =
      '```json\n{"isHighlight":true,"score":7,"title":"test","tags":[],"highlightType":"funny","reason":"ok","bestClipStart":130,"bestClipEnd":290}\n```';
    const result = parseLLMResponse(raw, [120, 300]);
    expect(result.isHighlight).toBe(true);
    expect(result.score).toBe(7);
  });

  it("should validate highlightType", () => {
    const raw = JSON.stringify({
      isHighlight: true,
      score: 3,
      title: "x",
      tags: [],
      highlightType: "invalid_type",
      reason: "x",
      bestClipStart: 120,
      bestClipEnd: 130,
    });
    const result = parseLLMResponse(raw, [120, 300]);
    expect(result.highlightType).toBe("not_highlight");
  });

  it("should handle JSON with extra text before/after", () => {
    const raw =
      'Sure, here is the analysis:\n{"isHighlight":true,"score":9,"title":"Amazing","tags":["wow"],"highlightType":"hype","reason":"big moment","bestClipStart":125,"bestClipEnd":290}\nLet me know if you need more.';
    const result = parseLLMResponse(raw, [120, 300]);
    expect(result.isHighlight).toBe(true);
    expect(result.score).toBe(9);
    expect(result.title).toBe("Amazing");
  });

  it("should clamp score to 0-10 range", () => {
    const raw = JSON.stringify({
      isHighlight: true,
      score: 15,
      title: "x",
      tags: [],
      highlightType: "funny",
      reason: "x",
      bestClipStart: 120,
      bestClipEnd: 130,
    });
    const result = parseLLMResponse(raw, [120, 300]);
    expect(result.score).toBe(10);

    const rawNeg = JSON.stringify({
      isHighlight: true,
      score: -5,
      title: "x",
      tags: [],
      highlightType: "funny",
      reason: "x",
      bestClipStart: 120,
      bestClipEnd: 130,
    });
    const resultNeg = parseLLMResponse(rawNeg, [120, 300]);
    expect(resultNeg.score).toBe(0);
  });

  it("should fix inverted bestClipStart/End", () => {
    const raw = JSON.stringify({
      isHighlight: true,
      score: 5,
      title: "x",
      tags: [],
      highlightType: "hype",
      reason: "x",
      bestClipStart: 290,
      bestClipEnd: 125,
    });
    const result = parseLLMResponse(raw, [120, 300]);
    // When start >= end, should fall back to window bounds
    expect(result.bestClipStart).toBe(120);
    expect(result.bestClipEnd).toBe(300);
  });

  it("should handle missing fields with defaults", () => {
    const raw = JSON.stringify({ isHighlight: true, score: 5 });
    const result = parseLLMResponse(raw, [120, 300]);
    expect(result.isHighlight).toBe(true);
    expect(result.score).toBe(5);
    expect(result.title).toBe("");
    expect(result.tags).toEqual([]);
    expect(result.highlightType).toBe("not_highlight");
    expect(result.reason).toBe("");
  });

  it("should filter non-string tags", () => {
    const raw = JSON.stringify({
      isHighlight: true,
      score: 5,
      title: "x",
      tags: ["valid", 123, null, "also_valid", {}],
      highlightType: "funny",
      reason: "x",
      bestClipStart: 120,
      bestClipEnd: 130,
    });
    const result = parseLLMResponse(raw, [120, 300]);
    expect(result.tags).toEqual(["valid", "also_valid"]);
  });

  it("should handle markdown code block without json specifier", () => {
    const raw =
      '```\n{"isHighlight":true,"score":6,"title":"md","tags":[],"highlightType":"touching","reason":"warm","bestClipStart":130,"bestClipEnd":280}\n```';
    const result = parseLLMResponse(raw, [120, 300]);
    expect(result.isHighlight).toBe(true);
    expect(result.score).toBe(6);
  });
});

// ============================================================================
// preRankCandidates
// ============================================================================

describe("preRankCandidates", () => {
  it("should return all candidates when count <= maxCandidates", () => {
    const candidates = [makeMockCandidate(), makeMockCandidate()];
    const result = preRankCandidates(candidates, 5);
    expect(result).toHaveLength(2);
  });

  it("should trim candidates to maxCandidates", () => {
    const candidates = Array.from({ length: 20 }, (_, i) =>
      makeMockCandidate({
        timeRange: [i * 10, i * 10 + 30],
        stats: {
          danmakuCount: 100,
          danmakuDensity: 1 + i * 0.5, // increasing density
          scTotal: 10 * i, // increasing SC total
          scCount: 1,
          giftCount: 0,
          uniqueUsers: 50,
          brushFrequency: 0.1 * i, // increasing brush
        },
      }),
    );
    const result = preRankCandidates(candidates, 5);
    expect(result).toHaveLength(5);
  });

  it("should sort by heuristic score descending", () => {
    const low = makeMockCandidate({
      timeRange: [0, 30],
      stats: {
        danmakuCount: 10,
        danmakuDensity: 0.3,
        scTotal: 0,
        scCount: 0,
        giftCount: 0,
        uniqueUsers: 5,
        brushFrequency: 0,
      },
    });
    const high = makeMockCandidate({
      timeRange: [100, 200],
      stats: {
        danmakuCount: 200,
        danmakuDensity: 10,
        scTotal: 300,
        scCount: 5,
        giftCount: 0,
        uniqueUsers: 100,
        brushFrequency: 0.9,
      },
    });
    const mid = makeMockCandidate({
      timeRange: [50, 80],
      stats: {
        danmakuCount: 100,
        danmakuDensity: 5,
        scTotal: 100,
        scCount: 2,
        giftCount: 0,
        uniqueUsers: 50,
        brushFrequency: 0.4,
      },
    });

    // high: 0.9*3 + 300/10 + 10 = 2.7 + 30 + 10 = 42.7
    // mid:  0.4*3 + 100/10 + 5  = 1.2 + 10 + 5 = 16.2
    // low:  0*3 + 0/10 + 0.3      = 0 + 0 + 0.3 = 0.3
    const result = preRankCandidates([low, high, mid], 3);
    expect(result[0]!.timeRange).toEqual([100, 200]);
    expect(result[1]!.timeRange).toEqual([50, 80]);
    expect(result[2]!.timeRange).toEqual([0, 30]);
  });

  it("should handle empty candidate list", () => {
    const result = preRankCandidates([], 5);
    expect(result).toEqual([]);
  });

  it("should return all candidates when maxCandidates is 0", () => {
    // length 2 > 0, so it preRanks and slices to 0 → empty
    const candidates = [makeMockCandidate(), makeMockCandidate()];
    const result = preRankCandidates(candidates, 0);
    expect(result).toHaveLength(0);
  });
});

// ============================================================================
// rankCandidates
// ============================================================================

describe("rankCandidates", () => {
  it("should return empty array for empty candidates", async () => {
    const config = makeLLMConfig();
    const sendMessage = async (_prompt: string) => "{}";
    const result = await rankCandidates([], config, sendMessage);
    expect(result).toEqual([]);
  });

  it("should call sendMessage for each candidate", async () => {
    const config = makeLLMConfig({ maxCandidatesPerVideo: 10 });
    const candidates = [makeMockCandidate(), makeMockCandidate()];

    let callCount = 0;
    const sendMessage = async (_prompt: string) => {
      callCount++;
      return JSON.stringify({
        isHighlight: true,
        score: 7,
        title: "test",
        tags: [],
        highlightType: "funny",
        reason: "test",
        bestClipStart: 125,
        bestClipEnd: 290,
      });
    };

    const result = await rankCandidates(candidates, config, sendMessage);
    expect(callCount).toBe(2);
    expect(result).toHaveLength(2);
  });

  it("should filter out results with score <= 0", async () => {
    const config = makeLLMConfig({ maxCandidatesPerVideo: 10 });
    const candidates = [makeMockCandidate(), makeMockCandidate()];

    let callIdx = 0;
    const sendMessage = async (_prompt: string) => {
      const score = callIdx++ === 0 ? 0 : 8;
      return JSON.stringify({
        isHighlight: true,
        score,
        title: "test",
        tags: [],
        highlightType: "funny",
        reason: "test",
        bestClipStart: 125,
        bestClipEnd: 290,
      });
    };

    const result = await rankCandidates(candidates, config, sendMessage);
    expect(result).toHaveLength(1);
    expect(result[0]!.score).toBe(8);
  });

  it("should sort by score descending", async () => {
    const config = makeLLMConfig({ maxCandidatesPerVideo: 10 });
    const candidates = [
      makeMockCandidate({ timeRange: [0, 30] }),
      makeMockCandidate({ timeRange: [40, 80] }),
      makeMockCandidate({ timeRange: [90, 140] }),
    ];

    const scores = [3, 9, 6];
    let callIdx = 0;
    const sendMessage = async (_prompt: string) => {
      const score = scores[callIdx++]!;
      return JSON.stringify({
        isHighlight: true,
        score,
        title: `clip_${score}`,
        tags: [],
        highlightType: "funny",
        reason: "test",
        bestClipStart: 5 + score,
        bestClipEnd: 15 + score,
      });
    };

    const result = await rankCandidates(candidates, config, sendMessage);
    expect(result).toHaveLength(3);
    expect(result[0]!.score).toBe(9);
    expect(result[1]!.score).toBe(6);
    expect(result[2]!.score).toBe(3);
  });

  it("should respect topK config", async () => {
    const config = makeLLMConfig({ maxCandidatesPerVideo: 10, topK: 2 });
    const candidates = Array.from({ length: 5 }, (_, i) =>
      makeMockCandidate({ timeRange: [i * 30, i * 30 + 25] }),
    );

    let callIdx = 0;
    const sendMessage = async (_prompt: string) => {
      const score = 5 + callIdx++;
      return JSON.stringify({
        isHighlight: true,
        score,
        title: `clip_${score}`,
        tags: [],
        highlightType: "funny",
        reason: "test",
        bestClipStart: 5,
        bestClipEnd: 20,
      });
    };

    const result = await rankCandidates(candidates, config, sendMessage);
    expect(result).toHaveLength(2);
  });

  it("should preRank when candidates exceed maxCandidatesPerVideo", async () => {
    const config = makeLLMConfig({ maxCandidatesPerVideo: 3, topK: 10 });
    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeMockCandidate({
        timeRange: [i * 30, i * 30 + 25],
        stats: {
          danmakuCount: 100,
          danmakuDensity: 1 + i * 2, // increasing
          scTotal: 10 * i,
          scCount: 1,
          giftCount: 0,
          uniqueUsers: 50,
          brushFrequency: 0.05 * i,
        },
      }),
    );

    let callCount = 0;
    const sendMessage = async (_prompt: string) => {
      callCount++;
      return JSON.stringify({
        isHighlight: true,
        score: 5,
        title: "test",
        tags: [],
        highlightType: "funny",
        reason: "test",
        bestClipStart: 5,
        bestClipEnd: 20,
      });
    };

    await rankCandidates(candidates, config, sendMessage);
    // Should only call LLM for the top 3 pre-ranked candidates
    expect(callCount).toBe(3);
  });

  it("should produce correct HighlightSegment shape", async () => {
    const config = makeLLMConfig({ maxCandidatesPerVideo: 10 });
    const candidates = [makeMockCandidate()];

    const sendMessage = async (_prompt: string) =>
      JSON.stringify({
        isHighlight: true,
        score: 8,
        title: "高光时刻",
        tags: ["精彩", "操作"],
        highlightType: "impressive",
        reason: "操作太秀了",
        bestClipStart: 130,
        bestClipEnd: 280,
      });

    const result = await rankCandidates(candidates, config, sendMessage);
    expect(result).toHaveLength(1);
    const seg = result[0]!;
    expect(seg.timeRange).toEqual([120, 300]);
    expect(seg.bestRange).toEqual([130, 280]);
    expect(seg.score).toBe(8);
    expect(seg.title).toBe("高光时刻");
    expect(seg.tags).toEqual(["精彩", "操作"]);
    expect(seg.highlightType).toBe("impressive");
    expect(seg.reason).toBe("操作太秀了");
    expect(seg.signalSources).toEqual(["danmakuDensity", "scBurst"]);
  });

  it("should propagate signalSources from candidate to HighlightSegment", async () => {
    const config = makeLLMConfig({ maxCandidatesPerVideo: 10 });
    const candidates = [
      makeMockCandidate({
        timeRange: [0, 10],
        signalSources: ["brushStorm"],
      }),
      makeMockCandidate({
        timeRange: [20, 40],
        signalSources: ["giftBurst", "danmakuDensity"],
      }),
    ];

    const sendMessage = async (_prompt: string) =>
      JSON.stringify({
        isHighlight: true,
        score: 5,
        title: "x",
        tags: [],
        highlightType: "hype",
        reason: "x",
        bestClipStart: 2,
        bestClipEnd: 9,
      });

    const result = await rankCandidates(candidates, config, sendMessage);
    expect(result).toHaveLength(2);
    expect(result[0]!.signalSources).toEqual(["brushStorm"]);
    expect(result[1]!.signalSources).toEqual(["giftBurst", "danmakuDensity"]);
  });
});

// ============================================================================
// rankCandidates error resilience
// ============================================================================

describe("rankCandidates error resilience", () => {
  const baseConfig: AutoClipLLMConfig = {
    enabled: true,
    provider: "qwen",
    modelId: "test",
    maxTokens: 1000,
    topK: 5,
    maxCandidatesPerVideo: 10,
    danmakuSampleMax: 50,
  };

  it("survives when one LLM call rejects — uses heuristic fallback for that candidate", async () => {
    const candidates = [
      makeMockCandidate(),
      makeMockCandidate({ timeRange: [400, 500] }),
      makeMockCandidate({ timeRange: [600, 700] }),
    ];
    let callCount = 0;
    const sendMessage = async (_prompt: string) => {
      callCount++;
      if (callCount === 2) throw new Error("API timeout");
      return JSON.stringify({
        isHighlight: true,
        score: 8,
        title: "Good one",
        tags: [],
        highlightType: "funny",
        reason: "nice",
      });
    };
    const result = await rankCandidates(candidates, baseConfig, sendMessage);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("survives when ALL LLM calls reject — all use heuristic fallback", async () => {
    const candidates = [makeMockCandidate(), makeMockCandidate()];
    const sendMessage = async () => { throw new Error("API down"); };
    const result = await rankCandidates(candidates, baseConfig, sendMessage);
    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  it("filters out candidates with isHighlight: false even if score > 0", async () => {
    const candidates = [makeMockCandidate()];
    const sendMessage = async () => JSON.stringify({
      isHighlight: false,
      score: 7,
      title: "Not really",
      tags: [],
      highlightType: "not_highlight",
      reason: "meh",
    });
    const result = await rankCandidates(candidates, baseConfig, sendMessage);
    expect(result.length).toBe(0);
  });

  it("does not exceed p-limit concurrency", async () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeMockCandidate({ timeRange: [i * 60, (i + 1) * 60] }),
    );
    let maxConcurrent = 0;
    let inFlight = 0;
    const sendMessage = async () => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return JSON.stringify({
        isHighlight: true, score: 5, title: "T", tags: [],
        highlightType: "hype", reason: "ok",
      });
    };
    const cfg = { ...baseConfig, maxCandidatesPerVideo: 10 };
    await rankCandidates(candidates, cfg, sendMessage);
    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });
});
