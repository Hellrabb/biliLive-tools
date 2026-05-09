import path from "node:path";
import Router from "@koa/router";
import logger from "@biliLive-tools/shared/utils/log.js";
import { autoClipModel } from "@biliLive-tools/shared/db/index.js";
import { container, appConfig } from "../index.js";

import type { AutoClipPreset as AutoClipPresetType } from "@biliLive-tools/types";

const router = new Router({ prefix: "/auto-clip" });

interface AutoClipPresetInstance {
  list: () => Promise<AutoClipPresetType[]>;
  get: (id: string) => Promise<AutoClipPresetType | undefined>;
  save: (data: AutoClipPresetType) => Promise<boolean>;
  delete: (id: string) => Promise<boolean>;
}

function getAutoClipPreset(): AutoClipPresetInstance {
  return container.resolve("autoClipPreset") as AutoClipPresetInstance;
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

  // 路径安全校验：禁止路径遍历和敏感系统路径（HTTP 层职责）
  const dangerousPatterns = [/\.\./, /^\/etc\//, /^\/proc\//, /^\/sys\//];
  if (dangerousPatterns.some(p => p.test(videoPath) || p.test(danmuPath))) {
    ctx.status = 400;
    ctx.body = { error: "Invalid path" };
    return;
  }

  const resolvedVideo = path.resolve(videoPath);
  const resolvedDanmu = path.resolve(danmuPath);

  try {
    const fs = await import("fs-extra");
    if (!(await fs.pathExists(resolvedVideo))) {
      ctx.status = 400;
      ctx.body = { error: `Video file not found: ${resolvedVideo}` };
      return;
    }
    if (!(await fs.pathExists(resolvedDanmu))) {
      ctx.status = 400;
      ctx.body = { error: `Danmu file not found: ${resolvedDanmu}` };
      return;
    }
  } catch {
    // fs-extra unavailable — skip file existence check (non-blocking)
  }

  try {
    const { AutoClipService } = await import("@biliLive-tools/shared/autoClip/service.js");

    const service = new AutoClipService({
      getAppConfig: () => appConfig.getAll(),
      getPreset: async (id: string) => {
        const preset = getAutoClipPreset();
        return preset.get(id);
      },
    });

    const result = await service.analyzeAndSave({
      videoPath: resolvedVideo,
      danmuPath: resolvedDanmu,
      presetId,
      skipAutoExport: true,
      onProgress: (_stage, _pct, message) => {
        logger.info(`[AutoClip] ${message}`);
      },
    });

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
    ctx.body = await doExportClips(
      ctx.params.id,
      result.video_path,
      highlights,
      result.preset_id,
      "AutoClip export",
    );
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

  try {
    const highlights = JSON.parse(result.highlights);
    ctx.body = await doExportClips(
      ctx.params.id,
      result.video_path,
      highlights,
      result.preset_id,
      "AutoClip re-export",
    );
  } catch (error: any) {
    logger.error("AutoClip re-export error:", error);
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

// ---------------------------------------------------------------------------
// Shared export helper — used by approve-and-export and re-export
// ---------------------------------------------------------------------------

async function doExportClips(
  resultId: string,
  videoPath: string,
  highlights: unknown[],
  presetId: string | null,
  logPrefix: string,
): Promise<{
  status: string;
  exportedPaths: string[];
  failedCount: number;
  errors: string[];
}> {
  const { exportClips } = await import("@biliLive-tools/shared/autoClip/pipeline.js");
  const { AUTO_CLIP_DEFAULT_CONFIG } = await import("@biliLive-tools/shared/presets/autoClipPreset.js");

  let exportConfig = AUTO_CLIP_DEFAULT_CONFIG.export;
  if (presetId) {
    try {
      const preset = getAutoClipPreset();
      const p = await preset.get(presetId);
      if (p?.config?.export) {
        exportConfig = p.config.export;
      }
    } catch {
      // fall back to default export config
    }
  }

  const effectiveConfig = {
    ...exportConfig,
    savePath: exportConfig.savePath || path.dirname(videoPath),
  };

  // Mark as exporting so UI can show progress during long export operations
  autoClipModel.updateStatus(resultId, "exporting");

  const exportResult = await exportClips(
    videoPath,
    highlights as any[],
    effectiveConfig,
    (_stage, _pct, msg) => logger.info(`${logPrefix}: ${msg}`),
  );

  const exportedPaths = exportResult.success.map((s: any) => s.path);
  if (exportedPaths.length > 0) {
    autoClipModel.markExported(resultId, exportedPaths);
  }

  return {
    status: exportedPaths.length > 0 ? "exported" : "failed",
    exportedPaths,
    failedCount: exportResult.failed.length,
    errors: exportResult.failed.map((f: any) => f.error),
  };
}

export default router;
