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
    return [{ field: "config", message: "配置必须是对象" }];
  }

  const c = config as Record<string, unknown>;

  // signal
  const signal = c.signal as Record<string, unknown> | undefined;
  if (!signal || typeof signal !== "object") {
    errors.push({ field: "config.signal", message: "信号检测配置为必填项" });
  } else {
    const numFields = [
      "danmakuDensityThreshold", "scMinAmount", "giftBurstThreshold",
      "giftBurstWindowSec", "minWindowDuration", "maxWindowDuration",
      "bucketSec", "mergeGapSec", "brushSimilarityThreshold",
    ] as const;
    for (const f of numFields) {
      if (typeof signal[f] !== "number" || !Number.isFinite(signal[f])) {
        errors.push({ field: `config.signal.${f}`, message: `${f} 必须是有限数字` });
      }
    }
    // validate windowPadding is a 2-element number array
    if (!Array.isArray(signal.windowPadding) || signal.windowPadding.length !== 2 ||
        typeof signal.windowPadding[0] !== "number" || typeof signal.windowPadding[1] !== "number") {
      errors.push({ field: "config.signal.windowPadding", message: "windowPadding 必须是 [number, number]" });
    }
  }

  // llm
  const llm = c.llm as Record<string, unknown> | undefined;
  if (!llm || typeof llm !== "object") {
    errors.push({ field: "config.llm", message: "LLM 配置为必填项" });
  } else {
    if (typeof llm.enabled !== "boolean") errors.push({ field: "config.llm.enabled", message: "enabled 必须是布尔值" });
    if (typeof llm.provider !== "string" || !["qwen", "ollama", "aliyun", "openai"].includes(llm.provider as string)) {
      errors.push({ field: "config.llm.provider", message: 'provider 必须是 "qwen"、"ollama"、"aliyun" 或 "openai"' });
    }
    if (typeof llm.topK !== "number" || !Number.isFinite(llm.topK) || (llm.topK as number) < 1) {
      errors.push({ field: "config.llm.topK", message: "topK 必须 >= 1" });
    }
    if (typeof llm.maxCandidatesPerVideo !== "number" || !Number.isFinite(llm.maxCandidatesPerVideo) || (llm.maxCandidatesPerVideo as number) < 1) {
      errors.push({ field: "config.llm.maxCandidatesPerVideo", message: "maxCandidatesPerVideo 必须 >= 1" });
    }
  }

  // export (optional: only validate if present)
  const exp = c.export as Record<string, unknown> | undefined;
  if (exp && typeof exp === "object") {
    if (typeof exp.cutFormat !== "string" || !["mp4", "flv"].includes(exp.cutFormat as string)) {
      errors.push({ field: "config.export.cutFormat", message: 'cutFormat 必须是 "mp4" 或 "flv"' });
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
    ctx.body = { error: "预设配置无效", details: errors };
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
    ctx.body = { error: "预设配置无效", details: errors };
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
    ctx.body = { error: "服务器内部错误" };
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
    ctx.body = { error: "presetId 必须是有效的 UUID" };
    return;
  }

  if (outputName && (/[\\/]/.test(outputName) || /\x00/.test(outputName))) {
    ctx.status = 400;
    ctx.body = { error: "输出名称包含非法字符" };
    return;
  }

  if (!videoPath || !danmuPath) {
    ctx.status = 400;
    ctx.body = { error: "videoPath 和 danmuPath 为必填项" };
    return;
  }

  // Check raw input for path traversal BEFORE resolve
  // (path.resolve normalizes .. away, so checking after is ineffective)
  if (/\.\./.test(videoPath) || /\.\./.test(danmuPath)) {
    ctx.status = 400;
    ctx.body = { error: "路径无效" };
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
    ctx.body = { error: "路径无效" };
    return;
  }

  try {
    const fs = await import("fs-extra");
    if (!(await fs.pathExists(resolvedVideo))) {
      ctx.status = 400;
      ctx.body = { error: "视频文件不存在" };
      return;
    }
    if (!(await fs.pathExists(resolvedDanmu))) {
      ctx.status = 400;
      ctx.body = { error: "弹幕文件不存在" };
      return;
    }
    // Reject unreasonably large danmaku XML files (>50 MB)
    const MAX_DANMU_SIZE_BYTES = 50 * 1024 * 1024;
    const danmuStat = await fs.stat(resolvedDanmu);
    if (danmuStat.size > MAX_DANMU_SIZE_BYTES) {
      ctx.status = 400;
      ctx.body = { error: `弹幕文件过大 (${(danmuStat.size / 1024 / 1024).toFixed(1)} MB)，上限 50 MB` };
      return;
    }
  } catch (err: any) {
    if (err?.code === "ERR_MODULE_NOT_FOUND" || err?.message?.includes("Cannot find module")) {
      // fs-extra unavailable — fallback to Node.js built-in fs
      const { access, constants } = await import("node:fs/promises");
      try {
        await access(resolvedVideo, constants.F_OK);
        await access(resolvedDanmu, constants.F_OK);
      } catch {
        ctx.status = 400;
        ctx.body = { error: "视频或弹幕文件不存在" };
        return;
      }
      // Skip size check when fs-extra is unavailable (non-blocking)
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
    ctx.body = { error: "请求过于频繁，请等待 30 秒后再试" };
    return;
  }

  if (activeRuns.size >= MAX_CONCURRENT_RUNS) {
    ctx.status = 429;
    ctx.body = { error: `并发分析数已达上限 (${MAX_CONCURRENT_RUNS})，请稍后重试` };
    return;
  }

  activeRuns.add(taskId);

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
    ctx.body = { error: "结果不存在" };
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
    ctx.body = { error: "数据损坏：highlights JSON 无效" };
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
    ctx.body = { error: "未找到" };
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
    ctx.body = { error: "数据损坏：highlights JSON 无效" };
  }
});

router.post("/clip/:id/approve", async (ctx) => {
  const result = autoClipModel.getResultById(ctx.params.id);
  if (!result) {
    ctx.status = 404;
    ctx.body = { error: "未找到" };
    return;
  }
  if (result.status !== "pending") {
    ctx.status = 400;
    ctx.body = { error: `无法批准：当前状态为 '${result.status}'` };
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
    ctx.body = { error: "未找到" };
    return;
  }

  if (result.status !== "pending") {
    ctx.status = 400;
    ctx.body = { error: `无法导出：当前状态为 '${result.status}'` };
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
    ctx.body = { error: "服务器内部错误" };
  }
});

// POST /auto-clip/clip/:id/re-export — 重新导出切片
router.post("/clip/:id/re-export", async (ctx) => {
  const result = autoClipModel.getResultById(ctx.params.id);
  if (!result) {
    ctx.status = 404;
    ctx.body = { error: "未找到" };
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
    ctx.body = { error: "服务器内部错误" };
  }
});

router.post("/clip/:id/delete", async (ctx) => {
  const result = autoClipModel.getResultById(ctx.params.id);
  if (!result) {
    ctx.status = 404;
    ctx.body = { error: "未找到" };
    return;
  }
  autoClipModel.deleteResult(ctx.params.id);
  ctx.body = { status: "deleted" };
});

// ---------------------------------------------------------------------------
// Shared export helper — used by approve-and-export and re-export
// ---------------------------------------------------------------------------

function isHighlightSegment(h: unknown): h is { bestRange: [number, number]; title?: string; score?: number; isHighlight?: boolean } {
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
  danmakuStatus?: string;
  danmakuError?: string;
}> {
  const { exportClips } = await import("@biliLive-tools/shared/autoClip/pipeline.js");
  const { AUTO_CLIP_DEFAULT_CONFIG } = await import("@biliLive-tools/shared/presets/autoClipPreset.js");

  let exportConfig = AUTO_CLIP_DEFAULT_CONFIG.export;

  async function tryLoadExportConfig(pid: string | null): Promise<boolean> {
    if (!pid) return false;
    try {
      const preset = getAutoClipPreset();
      const p = await preset.get(pid);
      if (p?.config?.export) {
        exportConfig = p.config.export;
        return true;
      }
    } catch { /* fall through */ }
    return false;
  }

  const loaded = await tryLoadExportConfig(presetId);

  if (!loaded) {
    // Fallback to global autoClipPresetId (same logic as service.ts analyzeAndSave)
    const config = container.resolve("appConfig") as any;
    const globalPresetId = config?.videoCut?.autoClipPresetId;
    if (globalPresetId && globalPresetId !== presetId) {
      await tryLoadExportConfig(globalPresetId);
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
        danmakuStatus: "skipped",
        danmakuError: "Export aborted before danmaku processing",
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

    return {
      status: exportedPaths.length > 0 ? "exported" : "failed",
      exportedPaths,
      failedCount,
      errors,
      danmakuStatus: exportResult.danmakuStatus,
      danmakuError: exportResult.danmakuError,
    };
  } catch (err: any) {
    logger.error(`${logPrefix}: exportClips threw:`, err);
    // Roll back status so the user can retry
    autoClipModel.updateStatus(resultId, "pending");
    return {
      status: "failed",
      exportedPaths: [],
      failedCount: highlights.length,
      errors: [err.message || String(err)],
      danmakuStatus: "skipped",
      danmakuError: `Export threw before danmaku processing: ${err.message || String(err)}`,
    };
  }
}

// POST /auto-clip/clips/batch-approve-and-export — 批量批准并导出
router.post("/clips/batch-approve-and-export", async (ctx) => {
  const { ids } = ctx.request.body as { ids?: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    ctx.status = 400;
    ctx.body = { error: "ids 数组为必填项" };
    return;
  }
  if (ids.length > 50) {
    ctx.status = 400;
    ctx.body = { error: "每批最多 50 个切片" };
    return;
  }

  if (ids.some((id) => typeof id !== "string" || !isValidUUID(id))) {
    ctx.status = 400;
    ctx.body = { error: "每个 id 必须是有效的 UUID" };
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
