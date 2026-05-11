import path from "node:path";
import logger from "../utils/log.js";
import { runAutoClipPipeline, exportClips } from "./pipeline.js";
import { buildSendMessage } from "./sendMessage.js";
import { AUTO_CLIP_DEFAULT_CONFIG } from "../presets/autoClipPreset.js";
import { autoClipModel } from "../db/index.js";

import type { AutoClipConfig, AutoClipPreset as AutoClipPresetType } from "@biliLive-tools/types";
import type { AutoClipResult, HighlightSegment } from "./types.js";
import type { ProgressCallback } from "./pipeline.js";

export interface AutoClipServiceDeps {
  getAppConfig: () => {
    ai: {
      models: Array<{ modelId: string; modelName?: string; vendorId?: string }>;
      vendors: Array<{ id: string; apiKey?: string; baseURL?: string }>;
    };
    videoCut?: {
      autoClipReviewMode?: boolean;
      autoClipExport?: boolean;
      autoClipUpload?: boolean;
      autoClipPresetId?: string;
    };
    uid?: number;
  };
  getPreset: (id: string) => Promise<AutoClipPresetType | undefined>;
}

export class AutoClipService {
  constructor(private deps: AutoClipServiceDeps) {}

  async analyzeAndSave(params: {
    videoPath: string;
    danmuPath: string;
    presetId?: string;
    recorderId?: string;
    /** HTTP 手动触发时设为 true，跳过自动导出/上传 */
    skipAutoExport?: boolean;
    onProgress?: ProgressCallback;
    /** External result ID for async mode polling. Auto-generated if not provided. */
    id?: string;
    /** Custom naming prefix for manual clip */
    outputName?: string;
  }): Promise<AutoClipResult> {
    const { videoPath, danmuPath, presetId, recorderId, skipAutoExport, onProgress, id, outputName } = params;

    // 1. Load preset config — explicit presetId takes priority
    let presetConfig = AUTO_CLIP_DEFAULT_CONFIG;
    if (presetId && presetId !== "") {
      try {
        const p = await this.deps.getPreset(presetId);
        presetConfig = p?.config ?? AUTO_CLIP_DEFAULT_CONFIG;
      } catch (e) {
        logger.warn("AutoClip: 加载预设失败，使用默认配置", e);
      }
    }

    // 2. Fallback to global autoClip preset — enables LLM for manual analysis
    const appConfig = this.deps.getAppConfig();
    if ((!presetId || presetId === "") && appConfig.videoCut?.autoClipPresetId) {
      try {
        const p = await this.deps.getPreset(appConfig.videoCut.autoClipPresetId);
        if (p?.config) {
          presetConfig = p.config;
          logger.info("AutoClip: using global autoClip preset for manual analysis");
        }
      } catch (e) {
        logger.warn("AutoClip: failed to load global preset fallback", e);
      }
    }

    // 3. Build sendMessage
    const sendMessage = await buildSendMessage({
      presetConfig,
      aiConfig: appConfig.ai,
    });

    // 3. Run pipeline
    const result = await runAutoClipPipeline({
      videoPath,
      danmuPath,
      presetConfig,
      sendMessage,
      onProgress,
      id,
    });

    // 3.5: Persist newly auto-detected filter rules back to preset
    const filterConfig = presetConfig.danmakuFilter;
    const activePresetId = presetId || appConfig.videoCut?.autoClipPresetId;
    if (activePresetId && filterConfig?.rules && filterConfig.rules.length > 0) {
      try {
        const preset = await this.deps.getPreset(activePresetId);
        if (preset) {
          const existingRules = preset.config.danmakuFilter?.rules ?? [];
          const existingPatterns = new Set(existingRules.map((r: { pattern: string }) => r.pattern));
          const newRules = filterConfig.rules.filter((r: { pattern: string }) => !existingPatterns.has(r.pattern));
          if (newRules.length > 0) {
            const updatedConfig = {
              ...preset.config,
              danmakuFilter: {
                ...preset.config.danmakuFilter,
                rules: [...existingRules, ...newRules],
              },
            };
            const { container } = await import("../index.js");
            const autoClipPreset = container.resolve("autoClipPreset");
            await autoClipPreset.update(activePresetId, updatedConfig);
            logger.info(`AutoClip: saved ${newRules.length} new filter rules to preset ${activePresetId}`);
          }
        }
      } catch (e) {
        logger.warn("AutoClip: failed to persist new filter rules to preset", e);
      }
    }

    // 4. Persist to DB — always upsert to overwrite any /run placeholder
    const videoCutCfg = appConfig.videoCut ?? {};
    const reviewMode = videoCutCfg.autoClipReviewMode ?? true;
    const status = reviewMode ? "pending" : "approved";

    try {
      // Preserve output_name from existing placeholder (for async manual analysis)
      let effectiveOutputName = outputName ?? null;
      if (id && !effectiveOutputName) {
        const existing = autoClipModel.getResultById(id);
        effectiveOutputName = existing?.output_name ?? null;
      }
      autoClipModel.upsertResult({
        id: result.id,
        video_path: videoPath,
        danmu_path: danmuPath,
        recorder_id: recorderId || null,
        preset_id: presetId || null,
        status,
        highlights: JSON.stringify(result.highlights),
        created_at: new Date().toISOString(),
        exported_at: null,
        uploaded_at: null,
        exported_paths: null,
        bili_aids: null,
        llm_fallback: result.llmFallback ? 1 : 0,
        output_name: effectiveOutputName,
      });

      if (result.skipped) {
        logger.info(`AutoClip: 结果已保存 (skipped, status=${status})`);
      } else {
        logger.info(`AutoClip: 结果已保存 (${result.highlights.length} highlights, status=${status})`);
      }

      if (!result.skipped && !skipAutoExport && !reviewMode && (videoCutCfg.autoClipExport ?? false) && result.highlights.length > 0) {
        await this.autoExportAndUpload(
          result.id,
          videoPath,
          danmuPath,
          result.highlights,
          presetConfig,
          appConfig,
        );
      }
    } catch (dbError) {
      logger.error("AutoClip: 持久化失败", dbError);
    }

    return result;
  }

  private async autoExportAndUpload(
    resultId: string,
    videoPath: string,
    danmuPath: string,
    highlights: HighlightSegment[],
    presetConfig: AutoClipConfig,
    appConfig: ReturnType<AutoClipServiceDeps["getAppConfig"]>,
  ) {
    const exportCfg = presetConfig.export;
    const savePath = exportCfg.savePath || path.dirname(videoPath);

    const presetCtx = await this.resolveExportPresets(exportCfg);
    logger.info(`AutoClip: 开始自动导出 ${highlights.length} 个切片...`);

    const exportResult = await exportClips(
      videoPath,
      danmuPath,
      highlights,
      { ...exportCfg, savePath },
      presetCtx,
      (_stage, _pct, msg) => logger.info(`AutoClip export: ${msg}`),
    );

    const exportedPaths = exportResult.success.map((s) => s.path);
    if (exportedPaths.length > 0) {
      autoClipModel.markExported(resultId, exportedPaths);
      logger.info(`AutoClip: 导出完成 ${exportedPaths.length} 个文件`);

      if (exportResult.failed.length > 0) {
        logger.warn(`AutoClip: ${exportResult.failed.length} 个切片导出失败`);
      }

      const videoCutCfg = appConfig.videoCut ?? {};
      // Global autoClipUpload is the master switch; preset export.uploadToBili is per-preset gate
      if ((videoCutCfg.autoClipUpload ?? false) && (presetConfig.export.uploadToBili ?? false)) {
        await this.uploadToBili(exportedPaths, highlights, appConfig);
      }

      try {
        const { sendNotify } = await import("../notify.js");
        await sendNotify(
          "autoClip 切片完成",
          `录制 ${path.basename(videoPath)} 自动切片完成，共 ${exportedPaths.length} 个高光片段`,
        );
      } catch {
        // notification may not be configured
      }
    }
  }

  private async uploadToBili(
    exportedPaths: string[],
    highlights: HighlightSegment[],
    appConfig: ReturnType<AutoClipServiceDeps["getAppConfig"]>,
  ) {
    try {
      const biliApi = (await import("../task/bili.js")).default;
      const { DEFAULT_BILIUP_CONFIG } = await import("../presets/videoPreset.js");
      const { container } = await import("../index.js");

      const uid = appConfig.uid;
      if (!uid) {
        logger.warn("AutoClip: 未配置默认B站UID，跳过自动上传");
        return;
      }

      let biliupConfig = DEFAULT_BILIUP_CONFIG;
      try {
        const videoPreset = container.resolve("videoPreset");
        const presets = await videoPreset.list();

        // Look for a preset explicitly named for autoClip, otherwise use safe default
        const autoClipBiliPreset = presets.find(
          (p: any) => p.name?.includes("autoClip") || p.name?.includes("自动切片")
        );
        if (autoClipBiliPreset?.config) {
          biliupConfig = autoClipBiliPreset.config;
        }
      } catch {
        // fallback to DEFAULT_BILIUP_CONFIG
      }

      for (let i = 0; i < exportedPaths.length; i++) {
        const expPath = exportedPaths[i]!;
        const highlight = highlights[i];
        const title = highlight?.title || path.parse(expPath).name;
        await biliApi.addMedia(
          [{ path: expPath, title }],
          { ...biliupConfig, title },
          uid,
        );
      }
      logger.info(`AutoClip: 已添加 ${exportedPaths.length} 个B站上传任务到队列`);
    } catch (uploadError) {
      logger.error("AutoClip: 自动上传B站失败", uploadError);
    }
  }

  private async resolveExportPresets(exportCfg: AutoClipConfig["export"]): Promise<{
    ffmpegConfig?: Record<string, unknown>;
    danmuConfig?: Record<string, unknown>;
  }> {
    const result: { ffmpegConfig?: Record<string, unknown>; danmuConfig?: Record<string, unknown> } = {};

    if (exportCfg.ffmpegPresetId) {
      try {
        const { container: diContainer } = await import("../index.js");
        const ffmpegPreset = diContainer.resolve("ffmpegPreset");
        const preset = await ffmpegPreset.get(exportCfg.ffmpegPresetId);
        if (preset?.config) {
          result.ffmpegConfig = preset.config as unknown as Record<string, unknown>;
        }
      } catch { /* use empty */ }
    }

    if (exportCfg.burnDanmaku) {
      try {
        const { container: diContainer } = await import("../index.js");
        const danmuPreset = diContainer.resolve("danmuPreset");
        const danmuPresetId = exportCfg.danmuPresetId || "default";
        const danmuPresetRecord = await danmuPreset.get(danmuPresetId);
        result.danmuConfig = (danmuPresetRecord?.config ?? danmuPreset.defaultConfig) as unknown as Record<string, unknown>;
      } catch { /* use empty */ }
    }

    return result;
  }
}
