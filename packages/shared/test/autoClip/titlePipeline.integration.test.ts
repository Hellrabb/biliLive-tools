import { describe, it, expect } from "vitest";
import { generateStyledTitles, buildTitlePrompt } from "../../src/autoClip/titleStyler.js";
import { understandContent } from "../../src/autoClip/contentUnderstanding.js";
import type { HighlightSegment } from "../../src/autoClip/types.js";
import type { AutoClipEnhancementConfig } from "@biliLive-tools/types";

function makeHighlights(count: number): HighlightSegment[] {
  const types: HighlightSegment["highlightType"][] = [
    "impressive", "funny", "touching", "hype", "troll",
  ];
  return Array.from({ length: count }, (_, i) => ({
    timeRange: [i * 60, i * 60 + 30] as [number, number],
    bestRange: [i * 60 + 5, i * 60 + 25] as [number, number],
    score: 10 - i,
    title: `事件${i + 1}：精彩瞬间摘要`,
    tags: i === 0 ? ["高能", "神操作"] : ["日常"],
    highlightType: types[i % types.length]!,
    reason: i === 0 ? "弹幕爆发，SC刷屏" : "弹幕活跃",
    signalSources: ["danmakuDensity"],
    isHighlight: true,
  }));
}

describe("Title Pipeline Integration", () => {
  it("should generate styled titles for all highlight types", async () => {
    const highlights = makeHighlights(3);
    const sendMessage = async (prompt: string) => {
      if (prompt.includes("典故意境")) {
        return '{"title": "一舞剑器动四方，直播间内尽锋芒"}';
      }
      if (prompt.includes("幽默俏皮")) {
        return '{"title": "主播这波操作，弹幕笑到打鸣"}';
      }
      return '{"title": "世间所有的相遇，都是久别重逢"}';
    };

    const result = await generateStyledTitles(
      highlights,
      { asrMap: new Map(), frameMap: new Map() },
      sendMessage,
    );

    expect(result).toHaveLength(3);
    // First clip gets opening prompt (典故意境)
    expect(result[0]!.title).toBe("一舞剑器动四方，直播间内尽锋芒");
  });

  it("should correctly route prompt styles by highlightType", () => {
    const funny = makeHighlights(1)[0]!;
    funny.highlightType = "funny";
    const prompt = buildTitlePrompt(funny, false, undefined, "弹幕热闹");
    expect(prompt).toContain("幽默俏皮");

    const touching = makeHighlights(1)[0]!;
    touching.highlightType = "touching";
    const prompt2 = buildTitlePrompt(touching, false, undefined, "弹幕感人");
    expect(prompt2).toContain("温情含蓄");

    const hype = makeHighlights(1)[0]!;
    hype.highlightType = "hype";
    const prompt3 = buildTitlePrompt(hype, false, undefined, "弹幕爆炸");
    expect(prompt3).toContain("热血澎湃");
  });

  it("should skip content understanding when enhancement disabled", async () => {
    const config: AutoClipEnhancementConfig = {
      asrEnabled: false,
      visualEnabled: false,
    };
    const result = await understandContent(
      "/nonexistent/v.mp4",
      makeHighlights(2),
      config,
      {},
    );
    expect(result.asrMap.size).toBe(0);
    expect(result.frameMap.size).toBe(0);
  });

  it("should preserve original titles when sendMessage always throws", async () => {
    const highlights = makeHighlights(2);
    const originalTitle0 = highlights[0]!.title;
    const originalTitle1 = highlights[1]!.title;

    const sendMessage = async () => {
      throw new Error("API down");
    };
    const result = await generateStyledTitles(
      highlights,
      { asrMap: new Map(), frameMap: new Map() },
      sendMessage,
    );

    expect(result[0]!.title).toBe(originalTitle0);
    expect(result[1]!.title).toBe(originalTitle1);
  });

  it("should enrich first clip title with ASR and frame context when available", async () => {
    const highlights = makeHighlights(1);
    let capturedPrompt = "";
    const sendMessage = async (prompt: string) => {
      capturedPrompt = prompt;
      return '{"title": "剑啸江湖，一声怒吼定乾坤"}';
    };

    const result = await generateStyledTitles(
      highlights,
      {
        asrMap: new Map([[0, "主播大喊：这波天秀！"]]),
        frameMap: new Map([[0, "激烈的游戏团战场景"]]),
      },
      sendMessage,
    );

    expect(result).toHaveLength(1);
    expect(capturedPrompt).toContain("主播大喊：这波天秀！");
    expect(capturedPrompt).toContain("激烈的游戏团战场景");
    expect(result[0]!.title).toBe("剑啸江湖，一声怒吼定乾坤");
  });
});
