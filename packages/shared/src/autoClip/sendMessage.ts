import type { AutoClipConfig, AutoClipLLMConfig } from "@biliLive-tools/types";
import logger from "../utils/log.js";

export interface SendMessageOptions {
  presetConfig: AutoClipConfig;
  aiConfig: {
    models: Array<{ modelId: string; modelName?: string; vendorId?: string }>;
    vendors: Array<{ id: string; apiKey?: string; baseURL?: string }>;
  };
}

/**
 * Build an LLM sendMessage callback from preset config + global AI config.
 * Returns undefined if LLM is disabled or configuration is incomplete.
 */
export async function buildSendMessage(
  opts: SendMessageOptions,
): Promise<((prompt: string, signal?: AbortSignal) => Promise<string>) | undefined> {
  const { presetConfig, aiConfig } = opts;
  const llmCfg = presetConfig.llm;

  if (!llmCfg.enabled) return undefined;

  const model = aiConfig.models.find((m) => m.modelId === llmCfg.modelId);
  if (!model) {
    logger.warn(`AutoClip: model "${llmCfg.modelId}" not found in AI config, LLM ranking disabled`);
    return undefined;
  }

  const vendor = aiConfig.vendors.find((v) => v.id === model.vendorId);
  if (!vendor) {
    logger.warn(`AutoClip: vendor "${model.vendorId}" not found for model "${llmCfg.modelId}", LLM ranking disabled`);
    return undefined;
  }

  if (llmCfg.provider === "qwen") {
    const { QwenLLM } = await import("../ai/llm/qwen.js");
    const llm = new QwenLLM({
      apiKey: vendor.apiKey ?? "",
      model: model.modelName,
      baseURL: vendor.baseURL,
    });
    return async (prompt: string, signal?: AbortSignal) => {
      const result = await llm.sendMessage(prompt, undefined, { signal });
      return result.content;
    };
  }

  if (llmCfg.provider === "ollama") {
    const { chat } = await import("../llm/ollama.js");
    const host = vendor.baseURL || "http://localhost:11434";
    return async (prompt: string, signal?: AbortSignal) => {
      const result = await chat({
        host,
        model: model.modelName ?? "qwen2.5",
        messages: [{ role: "user", content: prompt }],
        signal,
      });
      return result?.message?.content ?? "";
    };
  }

  logger.warn(`AutoClip: unknown LLM provider "${llmCfg.provider}", LLM ranking disabled`);
  return undefined;
}

export type SendMultimodalMessage = (
  prompt: string,
  images: string[],
  signal?: AbortSignal,
) => Promise<string>;

export interface BuildMultimodalOptions {
  llmConfig: AutoClipLLMConfig;
  aiConfig: {
    models: Array<{ modelId: string; modelName?: string; vendorId?: string }>;
    vendors: Array<{ id: string; apiKey?: string; baseURL?: string }>;
  };
}

/**
 * Build a multimodal message sender from AI config.
 * Returns undefined if no vision model is configured.
 */
export async function buildSendMultimodalMessage(
  opts: BuildMultimodalOptions,
): Promise<SendMultimodalMessage | undefined> {
  const { llmConfig, aiConfig } = opts;
  if (!llmConfig.visionModelId) return undefined;

  const model = aiConfig.models.find((m) => m.modelId === llmConfig.visionModelId);
  if (!model) {
    logger.warn(`AutoClip: vision model "${llmConfig.visionModelId}" not found`);
    return undefined;
  }

  const vendor = aiConfig.vendors.find((v) => v.id === model.vendorId);
  if (!vendor) {
    logger.warn(`AutoClip: vendor for vision model "${llmConfig.visionModelId}" not found`);
    return undefined;
  }

  if (llmConfig.provider === "qwen") {
    const { QwenLLM } = await import("../ai/llm/qwen.js");
    const llm = new QwenLLM({
      apiKey: vendor.apiKey ?? "",
      model: model.modelName,
      baseURL: vendor.baseURL,
    });
    return async (prompt: string, images: string[], signal?: AbortSignal) => {
      const result = await llm.sendMultimodalMessage(prompt, images, undefined, { signal });
      return result.content;
    };
  }

  if (llmConfig.provider === "ollama") {
    const { chatMultimodal } = await import("../llm/ollama.js");
    const host = vendor.baseURL || "http://localhost:11434";
    return async (prompt: string, images: string[], signal?: AbortSignal) => {
      return chatMultimodal({
        host,
        model: model.modelName ?? "llava",
        prompt,
        images,
        signal,
      });
    };
  }

  logger.warn(`AutoClip: multimodal not supported for provider "${llmConfig.provider}"`);
  return undefined;
}
