import path from "node:path";
import type { AwilixContainer } from "awilix";
import logger from "../utils/log.js";

import type { AutoClipConfig, VideoCodec, audioCodec, DanmuConfig } from "@biliLive-tools/types";
import type { AutoClipResult, HighlightSegment } from "./types.js";
import type { ProgressCallback } from "./pipeline.js";

// Re-export ProgressCallback for convenience (also in pipeline.ts)
export type { ProgressCallback } from "./pipeline.js";

export type DanmakuStatus = "rendered" | "skipped" | "failed";

export interface ExportClipsResult {
  success: Array<{ path: string; highlight: HighlightSegment }>;
  failed: Array<{ highlight: HighlightSegment; error: string }>;
  danmakuStatus: DanmakuStatus;
  danmakuError?: string;
}

/** Resolved preset configs — callers resolve from DI container and pass in */
export interface ExportPresetContext {
  ffmpegConfig?: Record<string, unknown>;
  danmuConfig?: Record<string, unknown>;
}

/**
 * Resolve ffmpeg and danmaku preset configs from the DI container.
 * Shared by service.ts (auto export) and routes/autoClip.ts (manual export).
 */
export async function resolveExportPresets(exportCfg: {
  ffmpegPresetId?: string;
  burnDanmaku?: boolean;
  danmuPresetId?: string;
}): Promise<ExportPresetContext> {
  const result: ExportPresetContext = {};
  let diContainer: AwilixContainer | undefined;

  if (exportCfg.ffmpegPresetId) {
    try {
      if (!diContainer) {
        ({ container: diContainer } = await import("../index.js"));
      }
      const ffmpegPreset = diContainer.resolve("ffmpegPreset") as {
        get: (id: string) => Promise<{ config?: unknown }>;
      };
      const preset = await ffmpegPreset.get(exportCfg.ffmpegPresetId);
      if (preset?.config) {
        result.ffmpegConfig = preset.config as Record<string, unknown>;
      }
    } catch (err) {
      logger.warn("AutoClip: failed to resolve ffmpeg preset for export", err);
    }
  }

  if (exportCfg.burnDanmaku) {
    const danmuPresetId = exportCfg.danmuPresetId || "default";
    logger.info(`AutoClip: burnDanmaku=enabled, resolving danmaku preset "${danmuPresetId}"`);
    try {
      if (!diContainer) {
        ({ container: diContainer } = await import("../index.js"));
      }
      const danmuPreset = diContainer.resolve("danmuPreset") as {
        get: (id: string) => Promise<{ config?: unknown }>;
        defaultConfig?: Record<string, unknown>;
      };
      const danmuPresetRecord = await danmuPreset.get(danmuPresetId);
      result.danmuConfig = (danmuPresetRecord?.config ?? danmuPreset.defaultConfig) as Record<string, unknown>;
      logger.info(`AutoClip: danmaku preset resolved (keys: ${Object.keys(result.danmuConfig ?? {}).length})`);
    } catch (err) {
      logger.warn("AutoClip: failed to resolve danmaku preset for export", err);
    }
  }

  return result;
}

/**
 * Export highlight clips to video files using the existing ffmpeg cut pipeline.
 *
 * Uses dynamic import for `task/video.js` to avoid circular dependencies
 * at module-load time. Returns structured result with per-clip success/failure
 * tracking so callers can distinguish partial success from total failure.
 */
export async function exportClips(
  videoPath: string,
  danmuPath: string,
  highlights: AutoClipResult["highlights"],
  exportConfig: AutoClipConfig["export"],
  presetCtx: ExportPresetContext,
  onProgress?: ProgressCallback,
  namingPrefix?: string,
  signal?: AbortSignal,
): Promise<ExportClipsResult> {
  const success: ExportClipsResult["success"] = [];
  const failed: ExportClipsResult["failed"] = [];
  let danmakuStatus: DanmakuStatus = "skipped";
  let danmakuError: string | undefined;

  const savePath = resolveSavePath(exportConfig, videoPath);
  const resolvedSavePath = path.resolve(savePath);

  // Resolve symlinks so path-traversal checks below are effective against
  // symlink-based escapes (path.resolve is string-only, doesn't follow links)
  let realSavePath: string;
  try {
    const { realpath } = await import("node:fs/promises");
    realSavePath = await realpath(resolvedSavePath);
  } catch {
    // If realpath fails (path doesn't exist yet, permission denied, etc.),
    // fall back to string-based check — it still catches ../ and absolute escapes
    realSavePath = resolvedSavePath;
  }

  // Use caller-resolved ffmpeg preset config
  const ffmpegPresetOpts: Record<string, unknown> = presetCtx.ffmpegConfig ?? {};

  // --- Danmaku burning setup ---
  logger.info(
    `AutoClip: export danmaku preflight — burnDanmaku=${exportConfig.burnDanmaku}, ` +
    `danmuPath=${danmuPath || "<empty>"}, ` +
    `danmuConfig=${presetCtx.danmuConfig ? `resolved (${Object.keys(presetCtx.danmuConfig).length} keys)` : "<missing>"}`,
  );
  let assPath: string | undefined;
  if (exportConfig.burnDanmaku && danmuPath && presetCtx.danmuConfig) {
    try {
      const { convertXml2Ass } = await import("../task/danmu.js");
      const { v4: uuid } = await import("uuid");
      const task = await convertXml2Ass(
        { input: danmuPath, output: uuid() },
        presetCtx.danmuConfig as DanmuConfig,
        { temp: true, saveRadio: 2, savePath: "", override: true },
      );
      // Wait for task completion (promisify event-based task)
      await new Promise<void>((resolve, reject) => {
        task.on("task-end", () => resolve());
        task.on("task-error", ({ error }: { error: string }) => reject(new Error(error)));
        task.on("task-cancel", () => reject(new Error("Danmaku conversion cancelled")));
      });
      // Verify ASS file was actually created and is non-empty
      const assOutput = task.output;
      if (!assOutput) {
        throw new Error("Danmaku task completed but output path is empty");
      }
      const { stat } = await import("node:fs/promises");
      const assStat = await stat(assOutput).catch(() => null);
      if (!assStat || assStat.size === 0) {
        throw new Error(
          `Danmaku ASS file ${assOutput}: ${!assStat ? "not found after conversion" : "empty (0 bytes)"}`,
        );
      }
      assPath = task.output;
      danmakuStatus = "rendered";
      logger.info(`AutoClip: danmaku ASS generated at ${assPath} (${assStat.size} bytes)`);
    } catch (err) {
      danmakuStatus = "failed";
      danmakuError = err instanceof Error ? err.message : String(err);
      logger.warn("AutoClip: danmaku ASS generation failed, exporting without danmaku", err);
    }
  } else if (exportConfig.burnDanmaku) {
    // burnDanmaku is true but one of the prerequisites is missing
    const missing: string[] = [];
    if (!danmuPath) missing.push("danmuPath (no danmaku XML file)");
    if (!presetCtx.danmuConfig) missing.push("danmuConfig (danmaku preset not resolved)");
    danmakuStatus = "skipped";
    danmakuError = `Danmaku rendering skipped: ${missing.join(", ")}`;
    logger.warn(`AutoClip: ${danmakuError}`);
  }

  // Dynamic import for cut once
  const { cut } = await import("../task/video.js");
  const { pathExists } = await import("fs-extra");
  const cutTasks: Array<{
    emitter: { on: (event: string, cb: (...args: any[]) => void) => void };
    status: string;
  }> = [];

  for (let i = 0; i < highlights.length; i++) {
    if (signal?.aborted) {
      break;
    }
    const h = highlights[i]!;
    const safeTitle = (h.title || "clip").replace(/[\\/:*?"<>|]/g, "_");
    const namingTemplate = exportConfig.namingTemplate ?? "{{title}}_{{index}}";
    let outputName = namingTemplate
      .split("{{title}}").join(safeTitle)
      .split("{{index}}").join(String(i + 1));

    if (namingPrefix) {
      outputName = `${namingPrefix}_${outputName}`;
    }

    // Strip path separators and traversal sequences to prevent
    // escaping savePath via malicious namingTemplate values
    outputName = outputName.replace(/\.\./g, "").replace(/[\\/]/g, "_");

    // Truncate to safe filename length (reserve headroom for extension + timestamp suffix)
    const MAX_FILENAME_BYTES = 200;
    let byteLen = Buffer.byteLength(outputName, "utf8");
    if (byteLen > MAX_FILENAME_BYTES) {
      // Truncate character-by-character to stay under byte limit
      let truncated = "";
      for (const ch of outputName) {
        const next = truncated + ch;
        if (Buffer.byteLength(next, "utf8") > MAX_FILENAME_BYTES - 3) break;
        truncated = next;
      }
      outputName = truncated + "...";
    }

    // Prevent filename collisions — append timestamp if file already exists
    let outputPath = path.join(
      resolvedSavePath,
      `${outputName}.${exportConfig.cutFormat}`,
    );

    // Verify output stays within savePath (defense in depth)
    if (!path.resolve(outputPath).startsWith(realSavePath + path.sep)) {
      logger.warn(
        `AutoClip: output path traversal blocked — ` +
        `outputPath=${outputPath}, savePath=${realSavePath}`,
      );
      failed.push({ highlight: h, error: "输出路径无效：路径穿越被拦截" });
      continue;
    }

    if (await pathExists(outputPath)) {
      const ts = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
      outputPath = path.join(
        resolvedSavePath,
        `${outputName}_${ts}.${exportConfig.cutFormat}`,
      );
      if (!path.resolve(outputPath).startsWith(realSavePath + path.sep)) {
        logger.warn("AutoClip: collision-avoidance path traversed unexpectedly");
        failed.push({ highlight: h, error: "输出路径无效：路径穿越被拦截" });
        continue;
      }
    }

    onProgress?.(
      "cut",
      Math.round((i / highlights.length) * 100),
      `Cutting: ${i + 1}/${highlights.length}`,
    );

    try {
      const task = await cut(
        { videoFilePath: videoPath, assFilePath: assPath },
        outputPath,
        {
          ...ffmpegPresetOpts,
          // Use ffmpeg preset's encoder when preset is configured,
          // otherwise fall back to autoclip's export.encoder
          encoder: ((Object.keys(ffmpegPresetOpts).length > 0
            ? ffmpegPresetOpts.encoder
            : undefined) ?? exportConfig.encoder ?? "libx264") as VideoCodec,
          audioCodec: (exportConfig.audioCodec ?? "copy") as audioCodec,
          ss: h.bestRange[0],
          to: h.bestRange[1],
        },
        { saveType: 2, savePath, override: true },
      );
      cutTasks.push(task);
      success.push({ path: outputPath, highlight: h });
    } catch (error) {
      logger.error(`AutoClip export error for highlight ${i}:`, error);
      failed.push({ highlight: h, error: String(error) });
    }
  }

  // Wait for all ffmpeg cut tasks to settle before cleaning up the temp ASS file.
  // mergeAssMp4 queues ffmpeg via taskQueue.addTask(task, false) and returns
  // immediately — the tasks run asynchronously, so we must wait here.
  if (cutTasks.length > 0) {
    await Promise.allSettled(
      cutTasks.map(
        (task) =>
          new Promise<void>((resolve) => {
            if (task.status === "completed" || task.status === "error") {
              resolve();
              return;
            }
            let settled = false;
            const done = () => {
              if (settled) return;
              settled = true;
              resolve();
            };
            task.emitter.on("task-end", done);
            task.emitter.on("task-error", done);
          }),
      ),
    );
  }

  // Clean up temp ASS file after all clips are exported
  if (assPath) {
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(assPath);
    } catch {
      // Best-effort cleanup — temp dir will eventually reclaim
    }
  }

  return { success, failed, danmakuStatus, danmakuError };
}

/** Resolve effective savePath from export config, falling back to video directory */
export function resolveSavePath(
  exportConfig: { savePath?: string },
  videoPath: string,
): string {
  return exportConfig.savePath || path.dirname(videoPath);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export async function getVideoDuration(
  videoPath: string,
  timeoutMs = 30_000,
): Promise<number> {
  const { readVideoMeta } = await import("../task/video.js");

  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`getVideoDuration timeout (${timeoutMs / 1000}s) for: ${videoPath}`)),
      timeoutMs,
    );
  });

  try {
    const meta = await Promise.race([readVideoMeta(videoPath), timeout]);
    if (timer !== undefined) clearTimeout(timer);
    const duration = meta?.format?.duration;
    if (!duration || duration <= 0) {
      throw new Error(`Cannot determine video duration for: ${videoPath}`);
    }
    return duration;
  } catch (err) {
    if (timer !== undefined) clearTimeout(timer);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Shared export helper — used by HTTP routes (manual export / re-export)
// ---------------------------------------------------------------------------

/**
 * Validate and normalize a highlight object from JSON.parse.
 * Patches missing required fields to safe defaults.
 * Returns true if the object has valid bestRange and timeRange.
 */
export function validateAndNormalizeHighlight(h: unknown): h is HighlightSegment {
  if (!h || typeof h !== "object") return false;
  const obj = h as Record<string, unknown>;

  const isValidRange = (key: string): boolean => {
    const r = obj[key];
    if (!Array.isArray(r) || r.length !== 2) return false;
    if (typeof r[0] !== "number" || typeof r[1] !== "number") return false;
    if (!Number.isFinite(r[0]) || !Number.isFinite(r[1])) return false;
    return true;
  };

  if (!isValidRange("bestRange") || !isValidRange("timeRange")) return false;

  if (typeof obj.score !== "number") (obj as Record<string, unknown>).score = 5;
  if (typeof obj.title !== "string") (obj as Record<string, unknown>).title = "Untitled";
  if (!Array.isArray(obj.tags)) (obj as Record<string, unknown>).tags = [];
  if (typeof obj.highlightType !== "string") (obj as Record<string, unknown>).highlightType = "hype";
  if (typeof obj.reason !== "string") (obj as Record<string, unknown>).reason = "";
  if (!Array.isArray(obj.signalSources)) (obj as Record<string, unknown>).signalSources = [];
  if (typeof obj.isHighlight !== "boolean") (obj as Record<string, unknown>).isHighlight = true;

  return true;
}

export interface ExportClipByIdResult {
  status: string;
  exportedPaths: string[];
  failedCount: number;
  errors: string[];
  danmakuStatus?: string;
  danmakuError?: string;
}

export interface ExportClipByIdDeps {
  getPreset: (id: string) => Promise<{ config?: { export?: AutoClipConfig["export"] } } | undefined>;
  getAppConfig: () => { videoCut?: { autoClipPresetId?: string } };
  getResultById: (id: string) => { output_name?: string | null } | undefined;
  updateStatus: (id: string, status: string) => void;
  markExported: (id: string, exportedPaths: string[]) => void;
  incrementRetry: (id: string) => boolean;
}

/**
 * Export clips for a given result row.
 * Resolves the export preset, validates highlights, runs exportClips,
 * and updates the DB status accordingly.
 */
export async function doExportClips(
  resultId: string,
  videoPath: string,
  danmuPath: string,
  highlights: unknown[],
  presetId: string | null,
  logPrefix: string,
  deps: ExportClipByIdDeps,
  signal?: AbortSignal,
): Promise<ExportClipByIdResult> {
  const EXPORT_TIMEOUT_MS = 10 * 60 * 1000;
  let exportSignal = signal;
  let exportTimer: ReturnType<typeof setTimeout> | undefined;
  if (!exportSignal) {
    const ctrl = new AbortController();
    exportTimer = setTimeout(() => {
      ctrl.abort();
      exportTimer = undefined;
    }, EXPORT_TIMEOUT_MS);
    exportSignal = ctrl.signal;
  }

  const { AUTO_CLIP_DEFAULT_CONFIG } = await import("../presets/autoClipPreset.js");

  let exportConfig = AUTO_CLIP_DEFAULT_CONFIG.export;

  async function tryLoadExportConfig(pid: string | null): Promise<boolean> {
    if (!pid) return false;
    try {
      const p = await deps.getPreset(pid);
      if (p?.config?.export) {
        exportConfig = p.config.export;
        return true;
      }
    } catch { /* fall through */ }
    return false;
  }

  const loaded = await tryLoadExportConfig(presetId);

  if (!loaded) {
    const config = deps.getAppConfig();
    const globalPresetId = config?.videoCut?.autoClipPresetId;
    if (globalPresetId && globalPresetId !== presetId) {
      await tryLoadExportConfig(globalPresetId);
    }
  }

  const effectiveConfig = {
    ...exportConfig,
    savePath: resolveSavePath(exportConfig, videoPath),
  };

  const presetCtx = await resolveExportPresets(exportConfig);

  deps.updateStatus(resultId, "exporting");

  let exportedPaths: string[] = [];
  let failedCount = 0;
  let errors: string[] = [];

  try {
    const validHighlights = highlights.filter(validateAndNormalizeHighlight);
    const skipped = highlights.length - validHighlights.length;
    if (skipped > 0) {
      logger.warn(`${logPrefix}: ${skipped}/${highlights.length} highlights have invalid shape, skipping`);
    }
    if (validHighlights.length === 0) {
      deps.updateStatus(resultId, "pending");
      return {
        status: "failed",
        exportedPaths: [],
        failedCount: highlights.length,
        errors: ["All highlights have invalid shape — cannot export"],
        danmakuStatus: "skipped",
        danmakuError: "Export aborted before danmaku processing",
      };
    }

    const dbRecord = deps.getResultById(resultId);
    const namingPrefix = dbRecord?.output_name || undefined;

    const exportResult = await exportClips(
      videoPath,
      danmuPath,
      validHighlights,
      effectiveConfig,
      presetCtx,
      (_stage, _pct, msg) => logger.info(`${logPrefix}: ${msg}`),
      namingPrefix,
      exportSignal,
    );

    exportedPaths = exportResult.success.map((s) => s.path);
    failedCount = exportResult.failed.length;
    errors = exportResult.failed.map((f) => f.error);

    if (exportedPaths.length > 0) {
      deps.markExported(resultId, exportedPaths);
    } else {
      if (deps.incrementRetry(resultId)) {
        deps.updateStatus(resultId, "pending");
      }
    }

    return {
      status: exportedPaths.length > 0 ? "exported" : "failed",
      exportedPaths,
      failedCount,
      errors,
      danmakuStatus: exportResult.danmakuStatus,
      danmakuError: exportResult.danmakuError,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`${logPrefix}: exportClips threw:`, err);

    if (deps.incrementRetry(resultId)) {
      deps.updateStatus(resultId, "pending");
    }

    return {
      status: "failed",
      exportedPaths: [],
      failedCount: highlights.length,
      errors: [errMsg],
      danmakuStatus: "failed",
      danmakuError: errMsg,
    };
  } finally {
    if (exportTimer !== undefined) clearTimeout(exportTimer);
  }
}
