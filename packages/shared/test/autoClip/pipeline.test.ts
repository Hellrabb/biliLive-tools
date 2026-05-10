import { describe, it, expect, vi } from "vitest";
import { runAutoClipPipeline } from "../../src/autoClip/pipeline";
import type { AutoClipConfig } from "@biliLive-tools/types";

// Mock parseDanmu to return empty danmaku data
vi.mock("../../src/danmu/index.js", () => ({
  parseDanmu: vi.fn().mockResolvedValue({
    danmu: [],
    sc: [],
    gift: [],
    guard: [],
    metadata: { video_start_time: 0 },
  }),
}));

// Mock readVideoMeta to return a known duration
vi.mock("../../src/task/video.js", () => ({
  readVideoMeta: vi.fn().mockResolvedValue({
    format: { duration: "120.5" },
  }),
  cut: vi.fn(),
}));

const defaultConfig: AutoClipConfig = {
  signal: {
    danmakuDensityThreshold: 2.5,
    scMinAmount: 30,
    giftBurstThreshold: 10,
    giftBurstWindowSec: 30,
    windowPadding: [30, 30],
    minWindowDuration: 60,
    maxWindowDuration: 300,
    bucketSec: 10,
    mergeGapSec: 30,
    brushSimilarityThreshold: 0.8,
  },
  llm: {
    enabled: false,
    provider: "ollama",
    modelId: "",
    maxTokens: 1000,
    topK: 5,
    maxCandidatesPerVideo: 15,
    danmakuSampleMax: 200,
  },
  enhancement: { asrEnabled: false, visualEnabled: false },
  export: {
    cutFormat: "mp4",
    encoder: "libx264",
    audioCodec: "copy",
    ffmpegPresetId: "default",
    burnDanmaku: false,
    uploadToBili: false,
    savePath: "",
    namingTemplate: "{{title}}_{{index}}",
  },
};

describe("runAutoClipPipeline", () => {
  it("returns skipped result when no danmaku data exists", async () => {
    const result = await runAutoClipPipeline({
      videoPath: "/fake/video.mp4",
      danmuPath: "/fake/danmu.xml",
      presetConfig: defaultConfig,
    });

    expect(result.skipped).toBe(true);
    expect(result.skippedReason).toBe("no_signal");
    expect(result.highlights).toEqual([]);
    expect(result.id).toBeTruthy();
    expect(result.videoPath).toBe("/fake/video.mp4");
    expect(result.danmuPath).toBe("/fake/danmu.xml");
  });

  it("generates a UUID id when not provided", async () => {
    const result = await runAutoClipPipeline({
      videoPath: "/fake/video.mp4",
      danmuPath: "/fake/danmu.xml",
      presetConfig: defaultConfig,
    });

    expect(result.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("uses provided id when passed", async () => {
    const result = await runAutoClipPipeline({
      videoPath: "/fake/video.mp4",
      danmuPath: "/fake/danmu.xml",
      presetConfig: defaultConfig,
      id: "my-custom-id",
    });

    expect(result.id).toBe("my-custom-id");
  });

  it("sets llmFallback when LLM enabled but sendMessage is undefined", async () => {
    const llmConfig = {
      ...defaultConfig,
      llm: { ...defaultConfig.llm, enabled: true },
    };
    const result = await runAutoClipPipeline({
      videoPath: "/fake/video.mp4",
      danmuPath: "/fake/danmu.xml",
      presetConfig: llmConfig,
    });

    expect(result.llmFallback).toBe(true);
  });
});
