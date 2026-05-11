import { describe, it, expect } from "vitest";
import { generateStyledTitles, buildTitlePrompt } from "../../src/autoClip/titleStyler.js";
import type { HighlightSegment } from "../../src/autoClip/types.js";

function makeHighlight(overrides: Partial<HighlightSegment> = {}): HighlightSegment {
  return {
    timeRange: [120, 300],
    bestRange: [125, 295],
    score: 8,
    title: "主播完成了极限反杀操作",
    tags: ["操作", "高能"],
    highlightType: "impressive",
    reason: "弹幕爆发+SC大额打赏",
    signalSources: ["danmakuDensity"],
    isHighlight: true,
    ...overrides,
  };
}

describe("buildTitlePrompt", () => {
  it("should use 典故意境 prompt for first clip (isFirstClip=true)", () => {
    const h = makeHighlight();
    const prompt = buildTitlePrompt(h, true, undefined, "弹幕疯狂刷666");
    expect(prompt).toContain("典故意境");
    expect(prompt).toContain("诗词典故");
    expect(prompt).toContain(h.title);
  });

  it("should use adaptive prompt for funny type", () => {
    const h = makeHighlight({ highlightType: "funny" });
    const prompt = buildTitlePrompt(h, false, undefined, "观众笑疯了");
    expect(prompt).toContain("幽默俏皮");
  });

  it("should include ASR transcript when provided", () => {
    const h = makeHighlight();
    const prompt = buildTitlePrompt(h, false, "主播说：卧槽这波天秀", "弹幕666");
    expect(prompt).toContain("主播说：卧槽这波天秀");
  });

  it("should include frame description when provided", () => {
    const h = makeHighlight();
    const prompt = buildTitlePrompt(h, false, undefined, "弹幕666", "激烈的团战场面");
    expect(prompt).toContain("激烈的团战场面");
  });
});

describe("generateStyledTitles", () => {
  it("should style first clip with opening prompt", async () => {
    const highlights = [
      makeHighlight({ score: 9, title: "极限反杀" }),
      makeHighlight({ score: 5, title: "日常聊天" }),
    ];

    const sendMessage = async (prompt: string) => {
      if (prompt.includes("典故意境")) {
        return '{"title": "一剑曾当百万师，此刻尽显神威"}';
      }
      return '{"title": "主播的日常，弹幕的狂欢"}';
    };

    const result = await generateStyledTitles(
      highlights,
      { asrMap: new Map(), frameMap: new Map() },
      sendMessage,
    );

    expect(result[0]!.title).toBe("一剑曾当百万师，此刻尽显神威");
    expect(result[1]!.title).toBe("主播的日常，弹幕的狂欢");
  });

  it("should preserve Phase 1 title when LLM fails", async () => {
    const highlights = [makeHighlight({ title: "原始摘要" })];
    const sendMessage = async () => { throw new Error("LLM down"); };

    const result = await generateStyledTitles(
      highlights,
      { asrMap: new Map(), frameMap: new Map() },
      sendMessage,
    );

    expect(result[0]!.title).toBe("原始摘要");
  });

  it("should handle empty highlights", async () => {
    const sendMessage = async () => '{"title": "unused"}';
    const result = await generateStyledTitles(
      [],
      { asrMap: new Map(), frameMap: new Map() },
      sendMessage,
    );
    expect(result).toEqual([]);
  });

  it("should use plain text as title when LLM returns non-JSON short text", async () => {
    const highlights = [makeHighlight({ title: "事件摘要" })];
    const sendMessage = async () => "一舞剑器动四方，直播间内尽锋芒";

    const result = await generateStyledTitles(
      highlights,
      { asrMap: new Map(), frameMap: new Map() },
      sendMessage,
    );

    expect(result[0]!.title).toBe("一舞剑器动四方，直播间内尽锋芒");
  });
});
