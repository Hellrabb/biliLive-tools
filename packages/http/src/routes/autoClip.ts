import pLimit from "p-limit";
import path from "node:path";
import Router from "@koa/router";
import logger from "@biliLive-tools/shared/utils/log.js";
import { autoClipModel } from "@biliLive-tools/shared/db/index.js";
import { resolveExportPresets } from "@biliLive-tools/shared/autoClip/pipeline.js";
import type { HighlightSegment } from "@biliLive-tools/shared/autoClip/types.js";
import { container } from "../index.js";
import type { AutoClipService } from "@biliLive-tools/shared/autoClip/service.js";

import type { AutoClipPreset as AutoClipPresetType } from "@biliLive-tools/types";

const router = new Router({ prefix: "/auto-clip" });

/** Maximum concurrent analysis runs */
const MAX_CONCURRENT_RUNS = 5;
const activeRuns = new Set<string>();

/** Per-client rate limiting for /run endpoint. Prevents abuse of LLM analysis. */
const runRateLimit = new Map<string, number>();
const RUN_RATE_LIMIT_MS = 30_000; // 30s cooldown per client
const MAX_RATE_LIMIT_ENTRIES = 1000;

function checkRunRateLimit(ip: string): boolean {
  const lastRun = runRateLimit.get(ip);
  const now = Date.now();
  if (lastRun && now - lastRun < RUN_RATE_LIMIT_MS) {
    return false;
  }
  runRateLimit.set(ip, now);
  // Prevent unbounded map growth
  if (runRateLimit.size > MAX_RATE_LIMIT_ENTRIES) {
    const entries = [...runRateLimit.entries()];
    entries.sort((a, b) => a[1] - b[1]);
    for (const [key] of entries.slice(0, 50)) {
      runRateLimit.delete(key);
    }
  }
  return true;
}

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(s: string): boolean {
  return UUID_RE.test(s);
}

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
    ctx.body = { error: "Internal server error" };
  }
});

// ===================== 手动触发 =====================

router.post("/run", async (ctx) => {
  const { videoPath, danmuPath, presetId, outputName } = ctx.request.body as {
    videoPath?: string;
    danmuPath?: string;
    presetId?: string;
    outputName?: string;
  };

  if (presetId && !isValidUUID(presetId)) {
    ctx.status = 400;
    ctx.body = { error: "presetId must be a valid UUID" };
    return;
  }

  if (outputName && /[\\/]/.test(outputName)) {
    ctx.status = 400;
    ctx.body = { error: "outputName must not contain path separators" };
    return;
  }

  if (!videoPath || !danmuPath) {
    ctx.status = 400;
    ctx.body = { error: "videoPath and danmuPath are required" };
    return;
  }

  // Check raw input for path traversal BEFORE resolve
  // (path.resolve normalizes .. away, so checking after is ineffective)
  if (/\.\./.test(videoPath) || /\.\./.test(danmuPath)) {
    ctx.status = 400;
    ctx.body = { error: "Invalid path" };
    return;
  }

  const resolvedVideo = path.resolve(videoPath);
  const resolvedDanmu = path.resolve(danmuPath);

  // Check resolved path against dangerous system prefixes
  const systemPrefixes = [
    /^\/etc\//, /^\/proc\//, /^\/sys\//, /^\/dev\//,
    /\x00/,
  ];
  if (systemPrefixes.some(p => p.test(resolvedVideo) || p.test(resolvedDanmu))) {
    ctx.status = 400;
    ctx.body = { error: "Invalid path" };
    return;
  }

  try {
    const fs = await import("fs-extra");
    if (!(await fs.pathExists(resolvedVideo))) {
      ctx.status = 400;
      ctx.body = { error: "Video file not found" };
      return;
    }
    if (!(await fs.pathExists(resolvedDanmu))) {
      ctx.status = 400;
      ctx.body = { error: "Danmu file not found" };
      return;
    }
    // Reject unreasonably large danmaku XML files (>50 MB)
    const MAX_DANMU_SIZE_BYTES = 50 * 1024 * 1024;
    const danmuStat = await fs.stat(resolvedDanmu);
    if (danmuStat.size > MAX_DANMU_SIZE_BYTES) {
      ctx.status = 400;
      ctx.body = { error: `Danmu file too large (${(danmuStat.size / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.` };
      return;
    }
  } catch (err: any) {
    if (err?.code === "ERR_MODULE_NOT_FOUND" || err?.message?.includes("Cannot find module")) {
      // fs-extra unavailable — skip file existence check (non-blocking)
    } else {
      throw err;
    }
  }

  const { v4: uuidv4 } = await import("uuid");
  const taskId = uuidv4();

  // Rate limit per client IP — prevent token-budget abuse
  const clientIp = (ctx.ip ?? ctx.request.ip ?? "unknown").toString();
  if (!checkRunRateLimit(clientIp)) {
    ctx.status = 429;
    ctx.body = { error: "Too many requests. Please wait 30 seconds between analyses." };
    return;
  }

  if (activeRuns.size >= MAX_CONCURRENT_RUNS) {
    ctx.status = 429;
    ctx.body = { error: `Too many concurrent analyses. Maximum ${MAX_CONCURRENT_RUNS}.` };
    return;
  }

  // Write placeholder so frontend polling immediately sees status
  autoClipModel.saveResult({
    id: taskId,
    video_path: resolvedVideo,
    danmu_path: resolvedDanmu,
    recorder_id: null,
    preset_id: presetId || null,
    status: "analyzing",
    highlights: "[]",
    created_at: new Date().toISOString(),
    exported_at: null,
    uploaded_at: null,
    exported_paths: null,
    bili_aids: null,
    llm_fallback: 0,
    output_name: outputName || null,
    highlight_count: 0,
    first_title: null,
  });

  activeRuns.add(taskId);

  // Fire-and-forget: return taskId immediately, execute pipeline in background
  (async () => {
    try {
      const service: AutoClipService = container.resolve("autoClipService");

      await service.analyzeAndSave({
        videoPath: resolvedVideo,
        danmuPath: resolvedDanmu,
        presetId,
        skipAutoExport: true,
        id: taskId,
        outputName: outputName || undefined,
        onProgress: (_stage, _pct, message) => {
          logger.info(`[AutoClip ${taskId}] ${message}`);
        },
      });

      logger.info(`[AutoClip ${taskId}] completed`);
    } catch (error: any) {
      logger.error(`[AutoClip ${taskId}] failed:`, error);
      try {
        // Don't delete — update to terminal state so frontend polling resolves
        autoClipModel.updateStatus(taskId, "failed");
      } catch { /* ignore cleanup errors */ }
    } finally {
      activeRuns.delete(taskId);
    }
  })();

  ctx.body = { taskId, status: "processing" };
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
  try {
    ctx.body = {
      ...rest,
      highlights: JSON.parse(result.highlights),
      llmFallback: llm_fallback === 1,
    };
  } catch {
    ctx.status = 500;
    ctx.body = { error: "Data corruption: highlights JSON is invalid" };
  }
});

// ===================== Clips 管理 =====================

router.get("/clips", async (ctx) => {
  const status = ctx.query.status as string | undefined;
  const rawLimit = parseInt(ctx.query.limit as string, 10);
  const rawOffset = parseInt(ctx.query.offset as string, 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(rawLimit, 200) : 50;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;

  const { data, total } = autoClipModel.getResults({
    status: status || undefined,
    limit: Math.min(limit, 200),
    offset,
  });

  ctx.body = {
    data: data.reduce((acc: any[], r) => {
      const { llm_fallback, ...rest } = r;
      try {
        acc.push({
          ...rest,
          highlights: JSON.parse(r.highlights),
          llmFallback: llm_fallback === 1,
        });
      } catch {
        logger.warn(`AutoClip: skipping row ${r.id} — invalid highlights JSON`);
      }
      return acc;
    }, []),
    total,
    limit: Math.min(limit, 200),
    offset,
  };
});

router.get("/clips/counts", async (ctx) => {
  ctx.body = autoClipModel.getStatusCounts();
});

router.get("/clip/:id", async (ctx) => {
  const result = autoClipModel.getResultById(ctx.params.id);
  if (!result) {
    ctx.status = 404;
    ctx.body = { error: "Not found" };
    return;
  }
  const { llm_fallback, ...rest } = result;
  try {
    ctx.body = {
      ...rest,
      highlights: JSON.parse(result.highlights),
      llmFallback: llm_fallback === 1,
    };
  } catch {
    ctx.status = 500;
    ctx.body = { error: "Data corruption: highlights JSON is invalid" };
  }
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
      result.danmu_path,
      highlights,
      result.preset_id,
      "AutoClip export",
    );
  } catch (error: any) {
    logger.error("AutoClip approve-and-export error:", error);
    ctx.status = 500;
    ctx.body = { error: "Internal server error" };
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
      result.danmu_path,
      highlights,
      result.preset_id,
      "AutoClip re-export",
    );
  } catch (error: any) {
    logger.error("AutoClip re-export error:", error);
    ctx.status = 500;
    ctx.body = { error: "Internal server error" };
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

function isHighlightSegment(h: unknown): h is { bestRange: [number, number]; title?: string } {
  if (!h || typeof h !== "object") return false;
  const obj = h as Record<string, unknown>;
  if (!Array.isArray(obj.bestRange) || obj.bestRange.length !== 2) return false;
  if (typeof obj.bestRange[0] !== "number" || typeof obj.bestRange[1] !== "number") return false;
  if (!Number.isFinite(obj.bestRange[0]) || !Number.isFinite(obj.bestRange[1])) return false;
  return true;
}

async function doExportClips(
  resultId: string,
  videoPath: string,
  danmuPath: string,
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

  const presetCtx = await resolveExportPresets(exportConfig);

  // Mark as exporting so UI can show progress during long export operations
  autoClipModel.updateStatus(resultId, "exporting");

  let exportedPaths: string[] = [];
  let failedCount = 0;
  let errors: string[] = [];

  try {
    // Validate highlights shape before passing to exportClips
    const validHighlights = highlights.filter(isHighlightSegment) as HighlightSegment[];
    const skipped = highlights.length - validHighlights.length;
    if (skipped > 0) {
      logger.warn(`${logPrefix}: ${skipped}/${highlights.length} highlights have invalid shape, skipping`);
    }
    if (validHighlights.length === 0) {
      autoClipModel.updateStatus(resultId, "pending");
      return {
        status: "failed",
        exportedPaths: [],
        failedCount: highlights.length,
        errors: ["All highlights have invalid shape — cannot export"],
      };
    }

    // Read custom naming prefix from DB record (for manual clip)
    const dbRecord = autoClipModel.getResultById(resultId);
    const namingPrefix = dbRecord?.output_name || undefined;

    const exportResult = await exportClips(
      videoPath,
      danmuPath,
      validHighlights,
      effectiveConfig,
      presetCtx,
      (_stage, _pct, msg) => logger.info(`${logPrefix}: ${msg}`),
      namingPrefix,
    );

    exportedPaths = exportResult.success.map((s: any) => s.path);
    failedCount = exportResult.failed.length;
    errors = exportResult.failed.map((f: any) => f.error);

    if (exportedPaths.length > 0) {
      autoClipModel.markExported(resultId, exportedPaths);
    } else {
      autoClipModel.updateStatus(resultId, "pending");
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

// POST /auto-clip/clips/batch-approve-and-export — 批量批准并导出
router.post("/clips/batch-approve-and-export", async (ctx) => {
  const { ids } = ctx.request.body as { ids?: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    ctx.status = 400;
    ctx.body = { error: "ids array is required" };
    return;
  }
  if (ids.length > 50) {
    ctx.status = 400;
    ctx.body = { error: "Maximum 50 clips per batch" };
    return;
  }

  if (ids.some((id) => typeof id !== "string" || !isValidUUID(id))) {
    ctx.status = 400;
    ctx.body = { error: "Each id must be a valid UUID" };
    return;
  }

  const BATCH_EXPORT_CONCURRENCY = 3;
  const limit = pLimit(BATCH_EXPORT_CONCURRENCY);

  const tasks = ids.map((id) =>
    limit(async () => {
      const result = autoClipModel.getResultById(id);
      if (!result) {
        return { id, status: "skipped" as const, exportedPaths: [] as string[], errors: ["Not found"] };
      }
      if (result.status !== "pending") {
        return { id, status: "skipped" as const, exportedPaths: [] as string[], errors: [`Status is '${result.status}'`] };
      }

      try {
        const highlights = JSON.parse(result.highlights);
        const exportResult = await doExportClips(
          id,
          result.video_path,
          result.danmu_path,
          highlights,
          result.preset_id,
          "AutoClip batch export",
        );
        return {
          id,
          status: exportResult.status,
          exportedPaths: exportResult.exportedPaths,
          errors: exportResult.errors,
        };
      } catch (err: any) {
        return { id, status: "failed" as const, exportedPaths: [] as string[], errors: [err.message || String(err)] };
      }
    }),
  );

  const settled = await Promise.allSettled(tasks);
  const results = settled.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { id: "unknown", status: "failed", exportedPaths: [], errors: [String(r.reason)] },
  );

  ctx.body = { results };
});

export default router;
