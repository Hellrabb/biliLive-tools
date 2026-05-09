import path from "node:path";
import Router from "@koa/router";
import logger from "@biliLive-tools/shared/utils/log.js";
import { runAutoClipPipeline } from "@biliLive-tools/shared/autoClip/pipeline.js";
import { autoClipModel } from "@biliLive-tools/shared/db/index.js";
import { container, appConfig } from "../index.js";

import type { AutoClipConfig, AutoClipPreset as AutoClipPresetType } from "@biliLive-tools/types";

const router = new Router({ prefix: "/auto-clip" });

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

// GET /auto-clip/default-config — 返回默认配置（供前端使用，确保单一事实来源）
router.get("/default-config", async (ctx) => {
  try {
    const { AUTO_CLIP_DEFAULT_CONFIG } = await import("@biliLive-tools/shared/presets/autoClipPreset.js");
    ctx.body = AUTO_CLIP_DEFAULT_CONFIG;
  } catch (error: any) {
    logger.error("AutoClip default-config error:", error);
    ctx.status = 500;
    ctx.body = { error: error.message };
  }
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

  const { buildSendMessage } = await import("@biliLive-tools/shared/autoClip/sendMessage.js");
  const sendMessage = await buildSendMessage({
    presetConfig,
    aiConfig: appConfig.getAll().ai,
  });

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

    // Save to DB
    try {
      autoClipModel.saveResult({
        id: result.id,
        video_path: videoPath,
        danmu_path: danmuPath,
        recorder_id: null,
        preset_id: presetId || null,
        status: "pending",
        highlights: JSON.stringify(result.highlights),
        created_at: new Date().toISOString(),
        exported_at: null,
        uploaded_at: null,
        exported_paths: null,
        bili_aids: null,
        llm_fallback: result.llmFallback ? 1 : 0,
      });
    } catch (e) {
      logger.error("Failed to save autoClip result:", e);
    }
    ctx.body = result;
  } catch (error: any) {
    logger.error("AutoClip run error:", error);
    ctx.status = 500;
    ctx.body = { error: error.message };
  }
});

router.get("/result/:id", async (ctx) => {
  const { id } = ctx.params;
  const result = autoClipModel.getResultById(id);
  if (!result) {
    ctx.status = 404;
    ctx.body = { error: "Result not found" };
    return;
  }
  const { llm_fallback, ...rest } = result;
  ctx.body = {
    ...rest,
    highlights: JSON.parse(result.highlights),
    llmFallback: llm_fallback === 1,
  };
});

// ===================== Clips 管理 =====================

router.get("/clips", async (ctx) => {
  const status = ctx.query.status as string | undefined;
  const { data, total } = autoClipModel.getResults({ status: status || undefined });
  ctx.body = {
    data: data.map(r => {
      const { llm_fallback, ...rest } = r;
      return {
        ...rest,
        highlights: JSON.parse(r.highlights),
        llmFallback: llm_fallback === 1,
      };
    }),
    total,
  };
});

router.get("/clip/:id", async (ctx) => {
  const result = autoClipModel.getResultById(ctx.params.id);
  if (!result) {
    ctx.status = 404;
    ctx.body = { error: "Not found" };
    return;
  }
  const { llm_fallback, ...rest } = result;
  ctx.body = {
    ...rest,
    highlights: JSON.parse(result.highlights),
    llmFallback: llm_fallback === 1,
  };
});

router.post("/clip/:id/approve", async (ctx) => {
  const result = autoClipModel.getResultById(ctx.params.id);
  if (!result) {
    ctx.status = 404;
    ctx.body = { error: "Not found" };
    return;
  }
  autoClipModel.updateStatus(ctx.params.id, "approved");
  ctx.body = { status: "approved" };
});

// POST /auto-clip/clip/:id/approve-and-export — 原子操作：批准并导出
router.post("/clip/:id/approve-and-export", async (ctx) => {
  const result = autoClipModel.getResultById(ctx.params.id);
  if (!result) {
    ctx.status = 404;
    ctx.body = { error: "Not found" };
    return;
  }

  if (result.status !== "pending") {
    ctx.status = 400;
    ctx.body = { error: `Cannot export: current status is '${result.status}'` };
    return;
  }

  try {
    const highlights = JSON.parse(result.highlights);

    const { exportClips } = await import("@biliLive-tools/shared/autoClip/pipeline.js");
    const { AUTO_CLIP_DEFAULT_CONFIG } = await import("@biliLive-tools/shared/presets/autoClipPreset.js");

    let exportConfig = AUTO_CLIP_DEFAULT_CONFIG.export;
    if (result.preset_id) {
      try {
        const preset = getAutoClipPreset();
        const p = await preset.get(result.preset_id);
        if (p?.config?.export) {
          exportConfig = p.config.export;
        }
      } catch {
        // fall back to default
      }
    }

    const effectiveConfig = {
      ...exportConfig,
      savePath: exportConfig.savePath || path.dirname(result.video_path),
    };

    const exportResult = await exportClips(
      result.video_path,
      highlights,
      effectiveConfig,
      (_stage, _pct, msg) => logger.info(`AutoClip export: ${msg}`),
    );

    const exportedPaths = exportResult.success.map(s => s.path);
    if (exportedPaths.length > 0) {
      autoClipModel.markExported(ctx.params.id, exportedPaths);
    }

    ctx.body = {
      status: exportedPaths.length > 0 ? "exported" : "failed",
      exportedPaths,
      failedCount: exportResult.failed.length,
      errors: exportResult.failed.map(f => f.error),
    };
  } catch (error: any) {
    logger.error("AutoClip approve-and-export error:", error);
    ctx.status = 500;
    ctx.body = { error: error.message };
  }
});

// POST /auto-clip/clip/:id/re-export — 重新导出切片
router.post("/clip/:id/re-export", async (ctx) => {
  const result = autoClipModel.getResultById(ctx.params.id);
  if (!result) {
    ctx.status = 404;
    ctx.body = { error: "Not found" };
    return;
  }

  const highlights = JSON.parse(result.highlights);

  try {
    const { exportClips } = await import("@biliLive-tools/shared/autoClip/pipeline.js");
    const { AUTO_CLIP_DEFAULT_CONFIG } = await import("@biliLive-tools/shared/presets/autoClipPreset.js");

    // Load export config from the original preset, fall back to defaults
    let exportConfig = AUTO_CLIP_DEFAULT_CONFIG.export;
    if (result.preset_id) {
      try {
        const preset = getAutoClipPreset();
        const p = await preset.get(result.preset_id);
        if (p?.config?.export) {
          exportConfig = p.config.export;
        }
      } catch {
        // fall back to default export config
      }
    }

    const effectiveConfig = {
      ...exportConfig,
      savePath: exportConfig.savePath || path.dirname(result.video_path),
    };

    const exportResult = await exportClips(
      result.video_path,
      highlights,
      effectiveConfig,
      (_stage, _pct, msg) => console.log(`AutoClip re-export: ${msg}`),
    );

    const exportedPaths = exportResult.success.map(s => s.path);
    if (exportedPaths.length > 0) {
      autoClipModel.markExported(ctx.params.id, exportedPaths);
    }

    ctx.body = {
      status: exportedPaths.length > 0 ? "exported" : (exportResult.failed.length > 0 ? "failed" : "nothing_to_export"),
      exportedPaths,
      failedCount: exportResult.failed.length,
      errors: exportResult.failed.map(f => f.error),
    };
  } catch (error: any) {
    console.error("Re-export error:", error);
    ctx.status = 500;
    ctx.body = { error: error.message };
  }
});

router.post("/clip/:id/delete", async (ctx) => {
  const result = autoClipModel.getResultById(ctx.params.id);
  if (!result) {
    ctx.status = 404;
    ctx.body = { error: "Not found" };
    return;
  }
  autoClipModel.deleteResult(ctx.params.id);
  ctx.body = { status: "deleted" };
});

export default router;
