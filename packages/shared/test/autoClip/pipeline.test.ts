import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAutoClipPipeline, exportClips } from "../../src/autoClip/pipeline";
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

const mockCutFn = vi.fn();

// Mock readVideoMeta to return a known duration
vi.mock("../../src/task/video.js", () => ({
  readVideoMeta: vi.fn().mockResolvedValue({
    format: { duration: "120.5" },
  }),
  cut: (...args: any[]) => mockCutFn(...args),
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
    danmuPresetId: "default",
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

// ---------------------------------------------------------------------------
// exportClips tests
// ---------------------------------------------------------------------------

const mockPathExists = vi.fn();
vi.mock("fs-extra", () => ({
  pathExists: (...args: any[]) => mockPathExists(...args),
}));

describe("exportClips", () => {
  const videoPath = "/fake/video.mp4";
  const danmuPath = "/fake/danmu.xml";
  const exportConfig: AutoClipConfig["export"] = {
    cutFormat: "mp4",
    encoder: "libx264",
    audioCodec: "copy",
    ffmpegPresetId: "",
    burnDanmaku: false,
    danmuPresetId: "default",
    uploadToBili: false,
    savePath: "/fake/output",
    namingTemplate: "{{title}}_{{index}}",
  };

  const highlights = [
    { title: "Highlight", bestRange: [10, 30] as [number, number] },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockPathExists.mockResolvedValue(false);
  });

  it("appends timestamp suffix when output file already exists", async () => {
    mockPathExists.mockResolvedValue(true);

    const result = await exportClips(videoPath, danmuPath, highlights as any, exportConfig, {});

    expect(result.success).toHaveLength(1);
    const outputPath: string = mockCutFn.mock.calls[0][1];
    // Should contain timestamp pattern _YYYYMMDDTHHmmss
    expect(outputPath).toMatch(/_\d{8}T\d{6}/);
    expect(result.failed).toHaveLength(0);
  });

  it("does NOT append timestamp when output file does not exist", async () => {
    mockPathExists.mockResolvedValue(false);

    const result = await exportClips(videoPath, danmuPath, highlights as any, exportConfig, {});

    expect(result.success).toHaveLength(1);
    const outputPath: string = mockCutFn.mock.calls[0][1];
    // Should be the plain name without timestamp
    expect(outputPath).toBe("/fake/output/Highlight_1.mp4");
  });

  it("prepends namingPrefix when provided", async () => {
    const result = await exportClips(
      videoPath,
      danmuPath,
      highlights as any,
      exportConfig,
      {},
      undefined,
      "myTest",
    );

    expect(result.success).toHaveLength(1);
    const outputPath: string = mockCutFn.mock.calls[0][1];
    expect(outputPath).toContain("myTest_Highlight_1");
  });

  it("passes override: true to cut", async () => {
    const result = await exportClips(videoPath, danmuPath, highlights as any, exportConfig, {});

    expect(result.success).toHaveLength(1);
    const cutOptions = mockCutFn.mock.calls[0][3];
    expect(cutOptions.override).toBe(true);
  });
});
