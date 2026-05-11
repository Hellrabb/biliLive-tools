import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AutoClipConfig } from "@biliLive-tools/types";

// --- mock defaults ---

const SAMPLE_PRESET_CONFIG: AutoClipConfig = {
  signal: {
    danmakuDensityThreshold: 3.0,
    scMinAmount: 50,
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
    enabled: true,
    provider: "ollama",
    modelId: "model-1",
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
  danmakuFilter: {
    enabled: false,
    rules: [],
    autoDetectEnabled: false,
  },
};

const DEFAULT_CONFIG: AutoClipConfig = {
  ...SAMPLE_PRESET_CONFIG,
  llm: { ...SAMPLE_PRESET_CONFIG.llm, enabled: true, modelId: "" },
};

// --- mocks must be hoisted (vitest) ---

const mockGetPreset = vi.fn();
const mockGetAppConfig = vi.fn();

vi.mock("../../src/presets/autoClipPreset.js", () => ({
  AUTO_CLIP_DEFAULT_CONFIG: {
    ...DEFAULT_CONFIG,
    llm: { ...DEFAULT_CONFIG.llm, enabled: true, modelId: "" },
  },
}));

vi.mock("../../src/autoClip/sendMessage.js", () => ({
  buildSendMessage: vi.fn(),
}));

vi.mock("../../src/autoClip/pipeline.js", () => ({
  runAutoClipPipeline: vi.fn(),
  exportClips: vi.fn(),
}));

vi.mock("../../src/db/index.js", () => ({
  autoClipModel: {
    upsertResult: vi.fn(),
    markExported: vi.fn(),
    updateStatus: vi.fn(),
    saveResult: vi.fn(),
  },
}));

describe("AutoClipService.analyzeAndSave — preset fallback", () => {
  let AutoClipService: any;
  let buildSendMessage: any;
  let runAutoClipPipeline: any;
  let service: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset mock returns
    mockGetPreset.mockReset();
    mockGetAppConfig.mockReset();

    const { buildSendMessage: bsm } = await import("../../src/autoClip/sendMessage.js");
    const { runAutoClipPipeline: rap } = await import("../../src/autoClip/pipeline.js");
    buildSendMessage = bsm;
    runAutoClipPipeline = rap;

    runAutoClipPipeline.mockResolvedValue({
      id: "test-result-id",
      videoPath: "/fake/v.mp4",
      danmuPath: "/fake/d.xml",
      highlights: [{ title: "高光1", score: 85 }],
      skipped: false,
      llmFallback: false,
    });

    buildSendMessage.mockResolvedValue(async (msg: string) => `LLM: ${msg}`);

    const { AutoClipService: ACS } = await import("../../src/autoClip/service.js");
    AutoClipService = ACS;

    service = new AutoClipService({
      getAppConfig: mockGetAppConfig,
      getPreset: mockGetPreset,
    });
  });

  it("uses global autoClipPresetId when no explicit presetId is provided", async () => {
    mockGetAppConfig.mockReturnValue({
      ai: { models: [], vendors: [] },
      videoCut: { autoClipPresetId: "global-preset-1" },
    });

    mockGetPreset.mockResolvedValue({ id: "global-preset-1", config: SAMPLE_PRESET_CONFIG });

    await service.analyzeAndSave({
      videoPath: "/fake/v.mp4",
      danmuPath: "/fake/d.xml",
      skipAutoExport: true,
    });

    // Global preset should have been fetched
    expect(mockGetPreset).toHaveBeenCalledWith("global-preset-1");

    // buildSendMessage should receive the global preset's config (with modelId: "model-1")
    const bsmCall = buildSendMessage.mock.calls[0][0];
    expect(bsmCall.presetConfig.llm.modelId).toBe("model-1");
  });

  it("explicit presetId takes priority over global fallback", async () => {
    const EXPLICIT_CONFIG: AutoClipConfig = {
      ...SAMPLE_PRESET_CONFIG,
      llm: { ...SAMPLE_PRESET_CONFIG.llm, modelId: "explicit-model" },
    };

    mockGetAppConfig.mockReturnValue({
      ai: { models: [], vendors: [] },
      videoCut: { autoClipPresetId: "global-preset-1" },
    });

    mockGetPreset.mockImplementation((id: string) => {
      if (id === "explicit-preset") return Promise.resolve({ id, config: EXPLICIT_CONFIG });
      if (id === "global-preset-1") return Promise.resolve({ id, config: SAMPLE_PRESET_CONFIG });
      return Promise.resolve(undefined);
    });

    await service.analyzeAndSave({
      videoPath: "/fake/v.mp4",
      danmuPath: "/fake/d.xml",
      presetId: "explicit-preset",
      skipAutoExport: true,
    });

    // Should use explicit preset, NOT global
    const bsmCall = buildSendMessage.mock.calls[0][0];
    expect(bsmCall.presetConfig.llm.modelId).toBe("explicit-model");

    // getPreset should NOT have been called with "global-preset-1"
    const globalCall = mockGetPreset.mock.calls.find(
      (c: string[]) => c[0] === "global-preset-1"
    );
    expect(globalCall).toBeUndefined();
  });

  it("uses DEFAULT_CONFIG when neither presetId nor global fallback is available", async () => {
    mockGetAppConfig.mockReturnValue({
      ai: { models: [], vendors: [] },
      videoCut: {}, // no autoClipPresetId
    });

    await service.analyzeAndSave({
      videoPath: "/fake/v.mp4",
      danmuPath: "/fake/d.xml",
      skipAutoExport: true,
    });

    // Should use default config (modelId: "")
    const bsmCall = buildSendMessage.mock.calls[0][0];
    expect(bsmCall.presetConfig.llm.modelId).toBe("");
  });

  it("handles getPreset rejection gracefully for global fallback", async () => {
    mockGetAppConfig.mockReturnValue({
      ai: { models: [], vendors: [] },
      videoCut: { autoClipPresetId: "broken-preset" },
    });

    mockGetPreset.mockRejectedValue(new Error("DB error"));

    // Should NOT throw
    await expect(
      service.analyzeAndSave({
        videoPath: "/fake/v.mp4",
        danmuPath: "/fake/d.xml",
        skipAutoExport: true,
      })
    ).resolves.toBeDefined();

    // Falls back to default (modelId: "")
    const bsmCall = buildSendMessage.mock.calls[0][0];
    expect(bsmCall.presetConfig.llm.modelId).toBe("");
  });
});
