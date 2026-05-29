import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSendMessage } from "../../src/autoClip/sendMessage";
import type { AutoClipConfig } from "@biliLive-tools/types";

// ---------------------------------------------------------------------------
// Mock: QwenLLM (aliyun/qwen provider)
// ---------------------------------------------------------------------------
const mockQwenSendMessage = vi.fn();
const MockQwenLLM = vi.fn().mockImplementation((_config: unknown) => ({
  sendMessage: mockQwenSendMessage,
}));

vi.mock("../../src/ai/llm/qwen.js", () => ({
  QwenLLM: MockQwenLLM,
}));

// ---------------------------------------------------------------------------
// Mock: ollama chat
// ---------------------------------------------------------------------------
const mockOllamaChat = vi.fn();

vi.mock("../../src/llm/ollama.js", () => ({
  chat: mockOllamaChat,
}));

// ---------------------------------------------------------------------------
// Mock: logger (suppress warnings in test output)
// ---------------------------------------------------------------------------
vi.mock("../../src/utils/log.js", () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAiConfig(overrides?: {
  models?: Array<{ modelId: string; modelName?: string; vendorId?: string }>;
  vendors?: Array<{ id: string; apiKey?: string; baseURL?: string; provider?: string }>;
}) {
  return {
    models: overrides?.models ?? [
      { modelId: "qwen-model-1", modelName: "qwen-plus", vendorId: "vendor-1" },
      { modelId: "ollama-model-1", modelName: "qwen2.5", vendorId: "vendor-ollama" },
      { modelId: "missing-vendor-model", modelName: "gpt-4", vendorId: "nonexistent" },
    ],
    vendors: overrides?.vendors ?? [
      { id: "vendor-1", apiKey: "sk-test", baseURL: "https://api.example.com", provider: "aliyun" },
      { id: "vendor-ollama", apiKey: "", baseURL: "http://localhost:11434", provider: "ollama" },
    ],
  };
}

function makePresetConfig(overrides?: Partial<AutoClipConfig>): AutoClipConfig {
  return {
    signal: {
      danmakuDensityThreshold: 2,
      scMinAmount: 30,
      giftBurstThreshold: 10,
      giftBurstWindowSec: 30,
      windowPadding: [5, 5],
      minWindowDuration: 5,
      maxWindowDuration: 300,
      bucketSec: 5,
      mergeGapSec: 15,
      brushSimilarityThreshold: 0.8,
    },
    llm: {
      enabled: true,
      provider: "qwen",
      modelId: "qwen-model-1",
      maxTokens: 1000,
      topK: 5,
      maxCandidatesPerVideo: 15,
      danmakuSampleMax: 200,
      contextWindowSec: 30,
    },
    enhancement: {
      asrEnabled: false,
      visualEnabled: false,
      boundaryRefineEnabled: false,
    },
    export: {
      cutFormat: "mp4",
      encoder: "libx264",
      audioCodec: "copy",
      ffmpegPresetId: "",
      burnDanmaku: false,
      danmuPresetId: "",
      uploadToBili: false,
      savePath: "/tmp",
      namingTemplate: "{{title}}_{{index}}",
    },
    danmakuFilter: {
      enabled: false,
      rules: [],
      autoDetectEnabled: false,
    },
    ...overrides,
  } as AutoClipConfig;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Provider routing
// ============================================================================

describe("buildSendMessage", () => {
  it("returns undefined when LLM is disabled", async () => {
    const presetConfig = makePresetConfig({
      llm: { ...makePresetConfig().llm, enabled: false },
    });

    const result = await buildSendMessage({
      presetConfig,
      aiConfig: makeAiConfig(),
    });

    expect(result).toBeUndefined();
  });

  it("returns undefined when model not found in aiConfig", async () => {
    const presetConfig = makePresetConfig({
      llm: { ...makePresetConfig().llm, modelId: "nonexistent-model" },
    });

    const result = await buildSendMessage({
      presetConfig,
      aiConfig: makeAiConfig(),
    });

    expect(result).toBeUndefined();
  });

  it("returns undefined when vendor not found for model", async () => {
    const presetConfig = makePresetConfig({
      llm: { ...makePresetConfig().llm, modelId: "missing-vendor-model" },
    });

    const result = await buildSendMessage({
      presetConfig,
      aiConfig: makeAiConfig(),
    });

    expect(result).toBeUndefined();
  });

  it("returns undefined for unknown provider", async () => {
    const presetConfig = makePresetConfig({
      llm: { ...makePresetConfig().llm, provider: "anthropic" as any },
    });

    const result = await buildSendMessage({
      presetConfig,
      aiConfig: makeAiConfig(),
    });

    expect(result).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Qwen provider
  // ---------------------------------------------------------------------------

  it("routes to QwenLLM for 'qwen' provider", async () => {
    mockQwenSendMessage.mockResolvedValue({ content: "hello from qwen" });

    const presetConfig = makePresetConfig({
      llm: { ...makePresetConfig().llm, provider: "qwen" },
    });

    const sendFn = await buildSendMessage({
      presetConfig,
      aiConfig: makeAiConfig(),
    });

    expect(sendFn).toBeDefined();
    expect(typeof sendFn).toBe("function");

    const result = await sendFn!("test prompt");
    expect(result).toBe("hello from qwen");
    expect(MockQwenLLM).toHaveBeenCalledTimes(1);
    expect(MockQwenLLM).toHaveBeenCalledWith({
      apiKey: "sk-test",
      model: "qwen-plus",
      baseURL: "https://api.example.com",
    });
    expect(mockQwenSendMessage).toHaveBeenCalledWith("test prompt", undefined, {
      signal: undefined,
    });
  });

  it("routes to QwenLLM for 'aliyun' provider", async () => {
    mockQwenSendMessage.mockResolvedValue({ content: "hello from aliyun" });

    const presetConfig = makePresetConfig({
      llm: { ...makePresetConfig().llm, provider: "aliyun" },
    });

    const sendFn = await buildSendMessage({
      presetConfig,
      aiConfig: makeAiConfig(),
    });

    expect(sendFn).toBeDefined();
    const result = await sendFn!("another prompt");
    expect(result).toBe("hello from aliyun");
    expect(MockQwenLLM).toHaveBeenCalledTimes(1);
  });

  it("passes AbortSignal to QwenLLM sendMessage", async () => {
    mockQwenSendMessage.mockResolvedValue({ content: "ok" });

    const presetConfig = makePresetConfig({
      llm: { ...makePresetConfig().llm, provider: "qwen" },
    });

    const sendFn = await buildSendMessage({
      presetConfig,
      aiConfig: makeAiConfig(),
    });
    expect(sendFn).toBeDefined();

    const controller = new AbortController();
    await sendFn!("prompt with signal", controller.signal);

    expect(mockQwenSendMessage).toHaveBeenCalledWith(
      "prompt with signal",
      undefined,
      { signal: controller.signal },
    );
  });

  it("uses fallback apiKey when vendor has none", async () => {
    mockQwenSendMessage.mockResolvedValue({ content: "ok" });

    const presetConfig = makePresetConfig({
      llm: { ...makePresetConfig().llm, provider: "qwen" },
    });

    const aiConfig = makeAiConfig({
      vendors: [
        { id: "vendor-1", apiKey: undefined, baseURL: "https://api.example.com", provider: "aliyun" },
        { id: "vendor-ollama", apiKey: "", baseURL: "http://localhost:11434", provider: "ollama" },
      ],
    });

    const sendFn = await buildSendMessage({ presetConfig, aiConfig });
    expect(sendFn).toBeDefined();

    expect(MockQwenLLM).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "" }),
    );
  });

  // ---------------------------------------------------------------------------
  // Ollama provider
  // ---------------------------------------------------------------------------

  it("routes to ollama chat for 'ollama' provider", async () => {
    mockOllamaChat.mockResolvedValue({
      message: { content: "hello from ollama" },
    });

    const presetConfig = makePresetConfig({
      llm: {
        ...makePresetConfig().llm,
        provider: "ollama",
        modelId: "ollama-model-1",
      },
    });

    const sendFn = await buildSendMessage({
      presetConfig,
      aiConfig: makeAiConfig(),
    });

    expect(sendFn).toBeDefined();
    const result = await sendFn!("ollama prompt");
    expect(result).toBe("hello from ollama");
    expect(mockOllamaChat).toHaveBeenCalledWith({
      host: "http://localhost:11434",
      model: "qwen2.5",
      messages: [{ role: "user", content: "ollama prompt" }],
      signal: undefined,
    });
  });

  it("passes AbortSignal to ollama chat", async () => {
    mockOllamaChat.mockResolvedValue({
      message: { content: "ok" },
    });

    const presetConfig = makePresetConfig({
      llm: {
        ...makePresetConfig().llm,
        provider: "ollama",
        modelId: "ollama-model-1",
      },
    });

    const sendFn = await buildSendMessage({
      presetConfig,
      aiConfig: makeAiConfig(),
    });
    expect(sendFn).toBeDefined();

    const controller = new AbortController();
    await sendFn!("signal test", controller.signal);

    expect(mockOllamaChat).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("uses default ollama host when vendor has no baseURL", async () => {
    mockOllamaChat.mockResolvedValue({
      message: { content: "ok" },
    });

    const presetConfig = makePresetConfig({
      llm: {
        ...makePresetConfig().llm,
        provider: "ollama",
        modelId: "ollama-model-1",
      },
    });

    const aiConfig = makeAiConfig({
      vendors: [
        { id: "vendor-1", apiKey: "sk-test", baseURL: "https://api.example.com", provider: "aliyun" },
        { id: "vendor-ollama", apiKey: "", provider: "ollama" },
      ],
    });

    const sendFn = await buildSendMessage({ presetConfig, aiConfig });
    expect(sendFn).toBeDefined();
    await sendFn!("test");

    expect(mockOllamaChat).toHaveBeenCalledWith(
      expect.objectContaining({ host: "http://localhost:11434" }),
    );
  });

  it("returns empty string when ollama response has no message content", async () => {
    mockOllamaChat.mockResolvedValue({ message: null });

    const presetConfig = makePresetConfig({
      llm: {
        ...makePresetConfig().llm,
        provider: "ollama",
        modelId: "ollama-model-1",
      },
    });

    const sendFn = await buildSendMessage({
      presetConfig,
      aiConfig: makeAiConfig(),
    });

    expect(sendFn).toBeDefined();
    const result = await sendFn!("test");
    expect(result).toBe("");
  });

  it("uses fallback model name when ollama model has no modelName", async () => {
    mockOllamaChat.mockResolvedValue({
      message: { content: "ok" },
    });

    const presetConfig = makePresetConfig({
      llm: {
        ...makePresetConfig().llm,
        provider: "ollama",
        modelId: "ollama-model-1",
      },
    });

    const aiConfig = makeAiConfig({
      models: [
        { modelId: "ollama-model-1", vendorId: "vendor-ollama" },
      ],
      vendors: [
        { id: "vendor-ollama", apiKey: "", baseURL: "http://localhost:11434", provider: "ollama" },
      ],
    });

    const sendFn = await buildSendMessage({ presetConfig, aiConfig });
    expect(sendFn).toBeDefined();
    await sendFn!("test");

    expect(mockOllamaChat).toHaveBeenCalledWith(
      expect.objectContaining({ model: "qwen2.5" }),
    );
  });
});
