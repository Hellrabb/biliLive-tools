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
  ctx.body = { ...result, highlights: JSON.parse(result.highlights) };
});

// ===================== Clips 管理 =====================

router.get("/clips", async (ctx) => {
  const status = ctx.query.status as string | undefined;
  const { data, total } = autoClipModel.getResults({ status: status || undefined });
  ctx.body = {
    data: data.map(r => ({ ...r, highlights: JSON.parse(r.highlights) })),
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
  ctx.body = { ...result, highlights: JSON.parse(result.highlights) };
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
    const exportResult = await exportClips(
      result.video_path,
      highlights,
      {
        cutFormat: "mp4",
        ffmpegPresetId: "default",
        burnDanmaku: false,
        uploadToBili: false,
        savePath: path.dirname(result.video_path),
        namingTemplate: "{{title}}_{{index}}_{{highlight_name}}",
      },
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
