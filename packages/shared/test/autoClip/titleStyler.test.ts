import { describe, it, expect } from "vitest";
import { generateStyledTitles, buildTitlePrompt, parseTitleResponse } from "../../src/autoClip/titleStyler.js";
import { makeHighlight } from "./mockData.js";

describe("buildTitlePrompt", () => {
  it("should use adaptive prompt for first clip (impressive type)", () => {
    const h = makeHighlight({ highlightType: "impressive" });
    const prompt = buildTitlePrompt(h, undefined, "弹幕疯狂刷666");
    expect(prompt).toContain("大气震撼");
    expect(prompt).toContain("冲击力的意象");
    expect(prompt).toContain(h.title);
  });

  it("should use adaptive prompt for funny type", () => {
    const h = makeHighlight({ highlightType: "funny" });
    const prompt = buildTitlePrompt(h, undefined, "观众笑疯了");
    expect(prompt).toContain("幽默俏皮");
  });

  it("should include ASR transcript when provided", () => {
    const h = makeHighlight();
    const prompt = buildTitlePrompt(h, "主播说：卧槽这波天秀", "弹幕666");
    expect(prompt).toContain("主播说：卧槽这波天秀");
  });

  it("should include frame description when provided", () => {
    const h = makeHighlight();
    const prompt = buildTitlePrompt(h, undefined, "弹幕666", "激烈的团战场面");
    expect(prompt).toContain("激烈的团战场面");
  });
});

describe("generateStyledTitles", () => {
  it("should style all clips with adaptive prompt by highlightType", async () => {
    const highlights = [
      makeHighlight({ score: 9, title: "极限反杀", highlightType: "impressive" }),
      makeHighlight({ score: 5, title: "日常聊天", highlightType: "funny" }),
    ];

    const sendMessage = async (prompt: string) => {
      if (prompt.includes("大气震撼")) {
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

describe("parseTitleResponse", () => {
  it('extracts title from valid JSON', () => {
    const result = parseTitleResponse('{"title": "江湖夜雨十年灯"}');
    expect(result).toBe("江湖夜雨十年灯");
  });

  it('rejects LLM error message in plain text', () => {
    expect(parseTitleResponse("I cannot generate this because")).toBeNull();
    expect(parseTitleResponse("Sorry, I'm unable to")).toBeNull();
    expect(parseTitleResponse("无法生成标题")).toBeNull();
  });

  it('accepts reasonable plain text title', () => {
    const result = parseTitleResponse("主播的惊天操作震惊全场观众");
    expect(result).toBe("主播的惊天操作震惊全场观众");
  });

  it('rejects text containing JSON braces', () => {
    expect(parseTitleResponse('{"error": "something went wrong"} extra text')).toBeNull();
  });
});
