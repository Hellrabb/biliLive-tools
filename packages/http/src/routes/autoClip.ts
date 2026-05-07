import Router from "@koa/router";
import logger from "@biliLive-tools/shared/utils/log.js";
import { runAutoClipPipeline } from "@biliLive-tools/shared/autoClip/pipeline.js";
import { container, appConfig } from "../index.js";

import type { AutoClipConfig, AutoClipPreset as AutoClipPresetType } from "@biliLive-tools/types";

const router = new Router({ prefix: "/auto-clip" });

const resultCache = new Map<string, any>();

function getAutoClipPreset() {
  return container.resolve("autoClipPreset") as any;
}

// ===================== 预设 CRUD =====================

router.get("/presets", async (ctx) => {
  const preset = getAutoClipPreset();
  ctx.body = await preset.list();
});

router.get("/preset/:id", async (ctx) => {
  const preset = getAutoClipPreset();
  ctx.body = await preset.get(ctx.params.id);
});

router.post("/preset", async (ctx) => {
  const preset = getAutoClipPreset();
  const data = ctx.request.body as AutoClipPresetType;
  ctx.body = await preset.save(data);
});

router.put("/preset/:id", async (ctx) => {
  const preset = getAutoClipPreset();
  const data = ctx.request.body as AutoClipPresetType;
  ctx.body = await preset.save({ ...data, id: ctx.params.id });
});

router.del("/preset/:id", async (ctx) => {
  const preset = getAutoClipPreset();
  ctx.body = await preset.delete(ctx.params.id);
});

// ===================== 手动触发 =====================

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

  let presetConfig: AutoClipConfig;
  if (presetId) {
    try {
      const preset = getAutoClipPreset();
      const p = await preset.get(presetId);
      presetConfig = p?.config ?? (await import("@biliLive-tools/shared/presets/autoClipPreset.js")).AUTO_CLIP_DEFAULT_CONFIG;
    } catch {
      presetConfig = (await import("@biliLive-tools/shared/presets/autoClipPreset.js")).AUTO_CLIP_DEFAULT_CONFIG;
    }
  } else {
    presetConfig = (await import("@biliLive-tools/shared/presets/autoClipPreset.js")).AUTO_CLIP_DEFAULT_CONFIG;
  }

  const sendMessage = await buildSendMessage(presetConfig);

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

// ===================== Clips 管理 =====================

router.get("/clips", async (ctx) => {
  ctx.body = Array.from(resultCache.values());
});

router.get("/clip/:id", async (ctx) => {
  const result = resultCache.get(ctx.params.id);
  if (!result) {
    ctx.status = 404;
    ctx.body = { error: "Not found" };
    return;
  }
  ctx.body = result;
});

router.post("/clip/:id/approve", async (ctx) => {
  const result = resultCache.get(ctx.params.id);
  if (!result) {
    ctx.status = 404;
    ctx.body = { error: "Not found" };
    return;
  }
  ctx.body = { status: "approved", message: "Export queued (not yet implemented)" };
});

router.post("/clip/:id/delete", async (ctx) => {
  const existed = resultCache.has(ctx.params.id);
  resultCache.delete(ctx.params.id);
  if (!existed) {
    ctx.status = 404;
    ctx.body = { error: "Not found" };
    return;
  }
  ctx.body = { status: "deleted" };
});

async function buildSendMessage(presetConfig: AutoClipConfig) {
  return async (prompt: string): Promise<string> => {
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
}

export default router;
