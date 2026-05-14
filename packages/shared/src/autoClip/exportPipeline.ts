import path from "node:path";
import logger from "../utils/log.js";

import type { AutoClipConfig, VideoCodec, audioCodec } from "@biliLive-tools/types";
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
  let diContainer: any;

  if (exportCfg.ffmpegPresetId) {
    try {
      if (!diContainer) {
        ({ container: diContainer } = await import("../index.js"));
      }
      const ffmpegPreset = diContainer.resolve("ffmpegPreset");
      const preset = await ffmpegPreset.get(exportCfg.ffmpegPresetId);
      if (preset?.config) {
        result.ffmpegConfig = preset.config as unknown as Record<string, unknown>;
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
      const danmuPreset = diContainer.resolve("danmuPreset");
      const danmuPresetRecord = await danmuPreset.get(danmuPresetId);
      result.danmuConfig = (danmuPresetRecord?.config ?? danmuPreset.defaultConfig) as unknown as Record<string, unknown>;
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
): Promise<ExportClipsResult> {
  const success: ExportClipsResult["success"] = [];
  const failed: ExportClipsResult["failed"] = [];
  let danmakuStatus: DanmakuStatus = "skipped";
  let danmakuError: string | undefined;

  const savePath = exportConfig.savePath || path.dirname(videoPath);

  // Use caller-resolved ffmpeg preset config
  const ffmpegPresetOpts: Partial<Record<string, unknown>> =
    (presetCtx.ffmpegConfig as Partial<Record<string, unknown>>) ?? {};

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
        presetCtx.danmuConfig as any,
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

  for (let i = 0; i < highlights.length; i++) {
    const h = highlights[i]!;
    const safeTitle = (h.title || "clip").replace(/[\\/:*?"<>|]/g, "_");
    let outputName = exportConfig.namingTemplate
      .split("{{title}}").join(safeTitle)
      .split("{{index}}").join(String(i + 1));

    if (namingPrefix) {
      outputName = `${namingPrefix}_${outputName}`;
    }

    // Truncate to safe filename length (reserve headroom for extension + timestamp suffix)
    const MAX_FILENAME_BYTES = 200;
    if (outputName.length > MAX_FILENAME_BYTES) {
      outputName = outputName.slice(0, MAX_FILENAME_BYTES - 3) + "...";
    }

    // Prevent filename collisions — append timestamp if file already exists
    let outputPath = path.join(
      savePath,
      `${outputName}.${exportConfig.cutFormat}`,
    );
    if (await pathExists(outputPath)) {
      const ts = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
      outputPath = path.join(
        savePath,
        `${outputName}_${ts}.${exportConfig.cutFormat}`,
      );
    }

    onProgress?.(
      "cut",
      Math.round((i / highlights.length) * 100),
      `Cutting: ${i + 1}/${highlights.length}`,
    );

    try {
      await cut(
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
      success.push({ path: outputPath, highlight: h });
    } catch (error) {
      logger.error(`AutoClip export error for highlight ${i}:`, error);
      failed.push({ highlight: h, error: String(error) });
    }
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export async function getVideoDuration(videoPath: string): Promise<number> {
  const { readVideoMeta } = await import("../task/video.js");
  const meta = await readVideoMeta(videoPath);
  const duration = meta?.format?.duration;
  if (!duration || duration <= 0) {
    throw new Error(`Cannot determine video duration for: ${videoPath}`);
  }
  return duration;
}
