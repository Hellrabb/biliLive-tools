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
  buildSendMultimodalMessage: vi.fn().mockResolvedValue(undefined),
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

// ---------------------------------------------------------------------------
// H2 + M6 tests
// ---------------------------------------------------------------------------

describe("AutoClipService.analyzeAndSave — cancel and error paths", () => {
  let AutoClipService: any;
  let buildSendMessage: any;
  let runAutoClipPipeline: any;
  let service: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockGetPreset.mockReset();
    mockGetAppConfig.mockReset();

    const { buildSendMessage: bsm } = await import("../../src/autoClip/sendMessage.js");
    const { runAutoClipPipeline: rap } = await import("../../src/autoClip/pipeline.js");
    buildSendMessage = bsm;
    runAutoClipPipeline = rap;

    buildSendMessage.mockResolvedValue(async (msg: string) => `LLM: ${msg}`);

    const { AutoClipService: ACS } = await import("../../src/autoClip/service.js");
    AutoClipService = ACS;

    service = new AutoClipService({
      getAppConfig: mockGetAppConfig,
      getPreset: mockGetPreset,
    });
  });

  // H2: When pipeline throws due to abort and params.id is undefined (recorder-triggered),
  // the catch block must return the auto-generated effectiveId, NOT an empty string.
  it("H2: cancel returns auto-generated ID, not empty string", async () => {
    mockGetAppConfig.mockReturnValue({
      ai: { models: [], vendors: [] },
      videoCut: {},
    });

    const ctrl = new AbortController();
    ctrl.abort();

    // Pipeline throws an AbortError, simulating what happens when checkAborted fires
    const abortErr = new DOMException("The operation was aborted", "AbortError");
    runAutoClipPipeline.mockRejectedValue(abortErr);

    // caller does NOT provide an id (recorder-triggered path)
    const result = await service.analyzeAndSave({
      videoPath: "/fake/v.mp4",
      danmuPath: "/fake/d.xml",
      skipAutoExport: true,
      signal: ctrl.signal,
    });

    // H2 fix: id MUST be a non-empty UUID, not ""
    expect(result.id).toBeTruthy();
    expect(result.id.length).toBeGreaterThan(0);
    expect(typeof result.id).toBe("string");
    // Should be a valid UUID format
    expect(result.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    // DB must NOT be called with an empty id
    const { autoClipModel } = await import("../../src/db/index.js");
    expect(autoClipModel.upsertResult).not.toHaveBeenCalled();
    expect(autoClipModel.saveResult).not.toHaveBeenCalled();
  });

  // H2 variant: when caller provides an explicit id, cancel must return it
  it("H2: cancel returns caller-provided ID when explicit id given", async () => {
    mockGetAppConfig.mockReturnValue({
      ai: { models: [], vendors: [] },
      videoCut: {},
    });

    const ctrl = new AbortController();
    ctrl.abort();

    const abortErr = new DOMException("The operation was aborted", "AbortError");
    runAutoClipPipeline.mockRejectedValue(abortErr);

    const result = await service.analyzeAndSave({
      videoPath: "/fake/v.mp4",
      danmuPath: "/fake/d.xml",
      skipAutoExport: true,
      id: "explicit-id-123",
      signal: ctrl.signal,
    });

    expect(result.id).toBe("explicit-id-123");
  });

  // M6: When pipeline throws a REAL error (not abort), and abort signal fires
  // between throw and catch, the catch must NOT swallow the real error as a cancel.
  it("M6: real error is not swallowed by late abort signal", async () => {
    mockGetAppConfig.mockReturnValue({
      ai: { models: [], vendors: [] },
      videoCut: {},
    });

    // Create an abort signal that fires between throw and catch
    // We simulate this by having the signal be "aborted" when catch runs
    const ctrl = new AbortController();
    // Signal IS aborted — simulates abort firing between pipeline throw and catch
    ctrl.abort();

    // Pipeline throws a REAL error (e.g., LLM timeout)
    const realError = new Error("LLM request timeout after 30s");
    runAutoClipPipeline.mockRejectedValue(realError);

    // M6 fix: the call must REJECT with the real error, NOT return a cancel response
    await expect(
      service.analyzeAndSave({
        videoPath: "/fake/v.mp4",
        danmuPath: "/fake/d.xml",
        skipAutoExport: true,
        signal: ctrl.signal,
      }),
    ).rejects.toThrow("LLM request timeout after 30s");

    // DB must NOT be polluted
    const { autoClipModel } = await import("../../src/db/index.js");
    expect(autoClipModel.upsertResult).not.toHaveBeenCalled();
  });

  // M6 variant: when pipeline throws an AbortError (true cancel), it should return cancel response
  it("M6: true abort (AbortError) still returns cancel response", async () => {
    mockGetAppConfig.mockReturnValue({
      ai: { models: [], vendors: [] },
      videoCut: {},
    });

    const ctrl = new AbortController();
    ctrl.abort();

    const abortErr = new DOMException("The operation was aborted", "AbortError");
    runAutoClipPipeline.mockRejectedValue(abortErr);

    const result = await service.analyzeAndSave({
      videoPath: "/fake/v.mp4",
      danmuPath: "/fake/d.xml",
      skipAutoExport: true,
      signal: ctrl.signal,
    });

    expect(result.skipped).toBe(true);
    expect(result.skippedReason).toBe("cancelled");
    expect(result.highlights).toEqual([]);
  });
});
