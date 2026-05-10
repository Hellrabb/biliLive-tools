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

// ---------------------------------------------------------------------------
// Preset validation
// ---------------------------------------------------------------------------

interface ValidationError {
  field: string;
  message: string;
}

function validatePresetConfig(config: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!config || typeof config !== "object") {
    return [{ field: "config", message: "config must be an object" }];
  }

  const c = config as Record<string, unknown>;

  // signal
  const signal = c.signal as Record<string, unknown> | undefined;
  if (!signal || typeof signal !== "object") {
    errors.push({ field: "config.signal", message: "signal config is required" });
  } else {
    const numFields = [
      "danmakuDensityThreshold", "scMinAmount", "giftBurstThreshold",
      "giftBurstWindowSec", "minWindowDuration", "maxWindowDuration",
      "bucketSec", "mergeGapSec", "brushSimilarityThreshold",
    ] as const;
    for (const f of numFields) {
      if (typeof signal[f] !== "number" || !Number.isFinite(signal[f])) {
        errors.push({ field: `config.signal.${f}`, message: `${f} must be a finite number` });
      }
    }
    // validate windowPadding is a 2-element number array
    if (!Array.isArray(signal.windowPadding) || signal.windowPadding.length !== 2 ||
        typeof signal.windowPadding[0] !== "number" || typeof signal.windowPadding[1] !== "number") {
      errors.push({ field: "config.signal.windowPadding", message: "windowPadding must be [number, number]" });
    }
  }

  // llm
  const llm = c.llm as Record<string, unknown> | undefined;
  if (!llm || typeof llm !== "object") {
    errors.push({ field: "config.llm", message: "llm config is required" });
  } else {
    if (typeof llm.enabled !== "boolean") errors.push({ field: "config.llm.enabled", message: "enabled must be boolean" });
    if (typeof llm.provider !== "string" || !["qwen", "ollama"].includes(llm.provider as string)) {
      errors.push({ field: "config.llm.provider", message: 'provider must be "qwen" or "ollama"' });
    }
    if (typeof llm.topK !== "number" || !Number.isFinite(llm.topK) || (llm.topK as number) < 1) {
      errors.push({ field: "config.llm.topK", message: "topK must be >= 1" });
    }
    if (typeof llm.maxCandidatesPerVideo !== "number" || !Number.isFinite(llm.maxCandidatesPerVideo) || (llm.maxCandidatesPerVideo as number) < 1) {
      errors.push({ field: "config.llm.maxCandidatesPerVideo", message: "maxCandidatesPerVideo must be >= 1" });
    }
  }

  // export (optional: only validate if present)
  const exp = c.export as Record<string, unknown> | undefined;
  if (exp && typeof exp === "object") {
    if (typeof exp.cutFormat !== "string" || !["mp4", "flv"].includes(exp.cutFormat as string)) {
      errors.push({ field: "config.export.cutFormat", message: 'cutFormat must be "mp4" or "flv"' });
    }
  }

  return errors;
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

  const errors = validatePresetConfig(data.config);
  if (errors.length > 0) {
    ctx.status = 400;
    ctx.body = { error: "Invalid preset config", details: errors };
    return;
  }

  ctx.body = await preset.save(data);
});

router.put("/preset/:id", async (ctx) => {
  const preset = getAutoClipPreset();
  const data = ctx.request.body as AutoClipPresetType;

  const errors = validatePresetConfig(data.config);
  if (errors.length > 0) {
    ctx.status = 400;
    ctx.body = { error: "Invalid preset config", details: errors };
    return;
  }

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
  const limit = ctx.query.limit ? parseInt(ctx.query.limit as string, 10) : 50;
  const offset = ctx.query.offset ? parseInt(ctx.query.offset as string, 10) : 0;

  const { data, total } = autoClipModel.getResults({
    status: status || undefined,
    limit: Math.min(limit, 200),
    offset,
  });

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
    limit: Math.min(limit, 200),
    offset,
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
  if (result.status !== "pending") {
    ctx.status = 400;
    ctx.body = { error: `Cannot approve: current status is '${result.status}'` };
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

  let exportedPaths: string[] = [];
  let failedCount = 0;
  let errors: string[] = [];

  try {
    const exportResult = await exportClips(
      videoPath,
      highlights as any[],
      effectiveConfig,
      (_stage, _pct, msg) => logger.info(`${logPrefix}: ${msg}`),
    );

    exportedPaths = exportResult.success.map((s: any) => s.path);
    failedCount = exportResult.failed.length;
    errors = exportResult.failed.map((f: any) => f.error);

    if (exportedPaths.length > 0) {
      autoClipModel.markExported(resultId, exportedPaths);
    }
  } catch (err: any) {
    logger.error(`${logPrefix}: exportClips threw:`, err);
    // Roll back status so the user can retry
    autoClipModel.updateStatus(resultId, "pending");
    return {
      status: "failed",
      exportedPaths: [],
      failedCount: highlights.length,
      errors: [err.message || String(err)],
    };
  }

  return {
    status: exportedPaths.length > 0 ? "exported" : "failed",
    exportedPaths,
    failedCount,
    errors,
  };
}

export default router;
