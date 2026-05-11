import { describe, it, expect } from "vitest";
import { understandContent } from "../../src/autoClip/contentUnderstanding.js";
import type { HighlightSegment } from "../../src/autoClip/types.js";
import type { AutoClipEnhancementConfig } from "@biliLive-tools/types";

function makeHighlight(overrides: Partial<HighlightSegment> = {}): HighlightSegment {
  return {
    timeRange: [120, 300],
    bestRange: [125, 295],
    score: 8,
    title: "极限反杀",
    tags: ["操作"],
    highlightType: "impressive",
    reason: "弹幕爆发",
    signalSources: ["danmakuDensity"],
    isHighlight: true,
    ...overrides,
  };
}

describe("understandContent", () => {
  it("should return empty maps when both ASR and visual disabled", async () => {
    const config: AutoClipEnhancementConfig = { asrEnabled: false, visualEnabled: false };
    const result = await understandContent(
      "/nonexistent/video.mp4",
      [makeHighlight()],
      config,
      {},
    );
    expect(result.asrMap.size).toBe(0);
    expect(result.frameMap.size).toBe(0);
  });

  it("should skip ASR when no recognizeASR provided", async () => {
    const config: AutoClipEnhancementConfig = { asrEnabled: true, visualEnabled: false };
    const result = await understandContent(
      "/nonexistent/video.mp4",
      [makeHighlight()],
      config,
      {},
    );
    expect(result.asrMap.size).toBe(0);
  });

  it("should call recognizeASR when enabled and provided", async () => {
    const config: AutoClipEnhancementConfig = { asrEnabled: true, visualEnabled: false };
    let calledWith = "";
    const result = await understandContent(
      "/nonexistent/video.mp4",
      [makeHighlight()],
      config,
      {
        recognizeASR: async (audioPath: string) => {
          calledWith = audioPath;
          return { text: "主播完成反杀" };
        },
        extractAudio: async () => "/tmp/test.wav",
      },
    );
    expect(result.asrMap.get(0)).toBe("主播完成反杀");
    expect(calledWith).toBe("/tmp/test.wav");
  });

  it("should send frames to multimodal when visual enabled", async () => {
    const config: AutoClipEnhancementConfig = { asrEnabled: false, visualEnabled: true };
    const capturedFrames: string[][] = [];
    const result = await understandContent(
      "/nonexistent/video.mp4",
      [makeHighlight()],
      config,
      {
        sendMultimodalMessage: async (_prompt, images) => {
          capturedFrames.push(images);
          return "一场激烈的团战";
        },
        sampleFrames: async () => ["data:image/jpeg;base64,xx"],
      },
    );
    expect(result.frameMap.get(0)).toBe("一场激烈的团战");
    expect(capturedFrames.length).toBe(1);
  });

  it("should continue processing remaining highlights after one fails", async () => {
    const config: AutoClipEnhancementConfig = { asrEnabled: true, visualEnabled: false };
    const highlights = [makeHighlight({ score: 9 }), makeHighlight({ score: 5 })];
    let callCount = 0;
    const result = await understandContent(
      "/nonexistent/video.mp4",
      highlights,
      config,
      {
        recognizeASR: async () => {
          callCount++;
          if (callCount === 1) throw new Error("ASR failed");
          return { text: "成功" };
        },
        extractAudio: async () => "/tmp/test.wav",
      },
    );
    expect(result.asrMap.get(0)).toBeUndefined();
    expect(result.asrMap.get(1)).toBe("成功");
  });

  it("should handle empty highlights array", async () => {
    const config: AutoClipEnhancementConfig = { asrEnabled: true, visualEnabled: true };
    const result = await understandContent("/nonexistent/video.mp4", [], config, {});
    expect(result.asrMap.size).toBe(0);
    expect(result.frameMap.size).toBe(0);
  });
});
