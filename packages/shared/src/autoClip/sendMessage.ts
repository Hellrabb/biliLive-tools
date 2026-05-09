import type { AutoClipConfig } from "@biliLive-tools/types";
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
): Promise<((prompt: string) => Promise<string>) | undefined> {
  const { presetConfig, aiConfig } = opts;
  const llmCfg = presetConfig.llm;

  if (!llmCfg.enabled) return undefined;

  const model = aiConfig.models.find((m) => m.modelId === llmCfg.modelId);
  const vendor = aiConfig.vendors.find((v) => v.id === model?.vendorId);

  if (llmCfg.provider === "qwen") {
    const { QwenLLM } = await import("../ai/llm/qwen.js");
    const llm = new QwenLLM({
      apiKey: vendor?.apiKey ?? "",
      model: model?.modelName,
      baseURL: vendor?.baseURL,
    });
    return async (prompt: string) => {
      const result = await llm.sendMessage(prompt);
      return result.content;
    };
  }

  if (llmCfg.provider === "ollama") {
    const { chat } = await import("../llm/ollama.js");
    return async (prompt: string) => {
      const result = await chat({
        host: vendor?.baseURL ?? "http://localhost:11434",
        model: model?.modelName ?? "qwen2.5",
        messages: [{ role: "user", content: prompt }],
      });
      return result?.message?.content ?? "";
    };
  }

  logger.warn(`AutoClip: unknown LLM provider "${llmCfg.provider}", LLM ranking disabled`);
  return undefined;
}
