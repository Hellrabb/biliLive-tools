import Router from "@koa/router";
import logger from "@biliLive-tools/shared/utils/log.js";
import { runAutoClipPipeline } from "@biliLive-tools/shared/autoClip/pipeline.js";
import { AUTO_CLIP_DEFAULT_CONFIG } from "@biliLive-tools/shared/presets/autoClipPreset.js";
import { appConfig } from "../index.js";

import type { AutoClipConfig } from "@biliLive-tools/types";

const router = new Router({ prefix: "/auto-clip" });

// In-memory result cache
const resultCache = new Map<string, any>();

// POST /auto-clip/run — manually trigger auto-clip
router.post("/run", async (ctx) => {
  const { videoPath, danmuPath, presetId } = ctx.request.body as {
    videoPath?: string;
    danmuPath?: string;
    presetId?: string;
  };

  if (!videoPath || !danmuPath) {
    ctx.status = 400;
    ctx.body = { error: "videoPath and danmuPath are required" };
    return;
  }

  // Load preset config
  let presetConfig: AutoClipConfig;
  if (presetId) {
    try {
      const { AutoClipPreset } = await import("@biliLive-tools/shared/presets/autoClipPreset.js");
      const globalConfig = appConfig.getAll();
      const presetPath = (globalConfig as any).ffmpegPresetPath?.replace("ffmpeg", "autoClip") ?? "";
      const preset = new AutoClipPreset(presetPath);
      const p = await preset.get(presetId);
      presetConfig = p?.config ?? AUTO_CLIP_DEFAULT_CONFIG;
    } catch {
      presetConfig = AUTO_CLIP_DEFAULT_CONFIG;
    }
  } else {
    presetConfig = AUTO_CLIP_DEFAULT_CONFIG;
  }

  // Build LLM sendMessage function from app config
  const sendMessage = async (prompt: string): Promise<string> => {
    if (presetConfig.llm.provider === "qwen") {
      const { QwenLLM } = await import("@biliLive-tools/shared/ai/llm/qwen.js");
      const aiConfig = appConfig.getAll().ai;
      const model = aiConfig.models.find((m: any) => m.modelId === presetConfig.llm.modelId);
      const vendor = aiConfig.vendors.find((v: any) => v.id === model?.vendorId);
      const llm = new QwenLLM({
        apiKey: vendor?.apiKey ?? "",
        model: model?.modelName,
        baseURL: vendor?.baseURL,
      });
      const result = await llm.sendMessage(prompt);
      return result.content;
    } else if (presetConfig.llm.provider === "ollama") {
      const { chat } = await import("@biliLive-tools/shared/llm/ollama.js");
      const aiConfig = appConfig.getAll().ai;
      const model = aiConfig.models.find((m: any) => m.modelId === presetConfig.llm.modelId);
      const vendor = aiConfig.vendors.find((v: any) => v.id === model?.vendorId);
      const result = await chat({
        host: vendor?.baseURL ?? "http://localhost:11434",
        model: model?.modelName ?? "qwen2.5",
        messages: [{ role: "user", content: prompt }],
      });
      return result?.message?.content ?? "";
    }
    throw new Error(`Unknown LLM provider: ${presetConfig.llm.provider}`);
  };

  try {
    const result = await runAutoClipPipeline({
      videoPath,
      danmuPath,
      presetConfig,
      sendMessage,
      onProgress: (_stage, _pct, message) => {
        logger.info(`[AutoClip] ${message}`);
      },
    });

    resultCache.set(result.id, result);
    ctx.body = result;
  } catch (error: any) {
    logger.error("AutoClip run error:", error);
    ctx.status = 500;
    ctx.body = { error: error.message };
  }
});

// GET /auto-clip/result/:id — query a result by ID
router.get("/result/:id", async (ctx) => {
  const { id } = ctx.params;
  const result = resultCache.get(id);
  if (!result) {
    ctx.status = 404;
    ctx.body = { error: "Result not found" };
    return;
  }
  ctx.body = result;
});

export default router;
