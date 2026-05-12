import path from "node:path";
import logger from "../utils/log.js";
import { runAutoClipPipeline, exportClips, resolveExportPresets } from "./pipeline.js";
import { buildSendMessage, buildSendMultimodalMessage } from "./sendMessage.js";
import { AUTO_CLIP_DEFAULT_CONFIG } from "../presets/autoClipPreset.js";
import { autoClipModel } from "../db/index.js";
import { cloneDeep } from "lodash-es";

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
    let presetConfig = cloneDeep(AUTO_CLIP_DEFAULT_CONFIG);
    if (presetId && presetId !== "") {
      try {
        const p = await this.deps.getPreset(presetId);
        presetConfig = p?.config ? cloneDeep(p.config) : cloneDeep(AUTO_CLIP_DEFAULT_CONFIG);
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
          presetConfig = cloneDeep(p.config);
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

    // Build multimodal message sender for Phase 1.5 frame description
    const sendMultimodalMessage = await buildSendMultimodalMessage({
      llmConfig: presetConfig.llm,
      aiConfig: appConfig.ai,
    });

    // Build ASR recognize function for Phase 1.5 speech-to-text
    let recognizeASR: ((audioPath: string) => Promise<{ text: string }>) | undefined;
    if (presetConfig.enhancement?.asrEnabled) {
      try {
        const { recognize } = await import("../ai/asr/index.js");
        const asrModelId = presetConfig.llm.asrModelId ?? presetConfig.llm.modelId;
        recognizeASR = async (audioPath: string) => {
          const result = await recognize(audioPath, asrModelId);
          return { text: result.text };
        };
      } catch (err) {
        logger.warn("AutoClip: ASR provider initialization failed, ASR disabled", err);
      }
    }

    // Resolve system ffmpeg path for frame sampler and audio extractor
    let sysFfmpegPath = "ffmpeg";
    try {
      const { getBinPath } = await import("../task/video.js");
      sysFfmpegPath = getBinPath().ffmpegPath || "ffmpeg";
    } catch {
      // Fallback to "ffmpeg" when config is unavailable (e.g., test env)
    }

    // 3. Run pipeline
    const result = await runAutoClipPipeline({
      videoPath,
      danmuPath,
      presetConfig,
      sendMessage,
      sendMultimodalMessage,
      recognizeASR,
      onProgress,
      id,
      ffmpegPath: sysFfmpegPath,
    });

    // Pattern-based filter rule dedup provides best-effort mitigation
    // against concurrent analyses on the same preset. A true TOCTOU fix
    // would require file-level locking. In practice this is rare.
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
            await autoClipPreset.save({ id: activePresetId, name: preset.name, config: updatedConfig });
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
      const highlightsJson = JSON.stringify(result.highlights);
      let highlightCount = 0;
      let firstTitle: string | null = null;
      try {
        const parsed = result.highlights;
        if (Array.isArray(parsed) && parsed.length > 0) {
          highlightCount = parsed.length;
          firstTitle = parsed[0]?.title || null;
        }
      } catch { /* keep defaults */ }

      autoClipModel.upsertResult({
        id: result.id,
        video_path: videoPath,
        danmu_path: danmuPath,
        recorder_id: recorderId || null,
        preset_id: presetId || null,
        status,
        highlights: highlightsJson,
        created_at: new Date().toISOString(),
        exported_at: null,
        uploaded_at: null,
        exported_paths: null,
        bili_aids: null,
        llm_fallback: result.llmFallback ? 1 : 0,
        output_name: effectiveOutputName,
        highlight_count: highlightCount,
        first_title: firstTitle,
      });

      if (result.skipped) {
        logger.info(`AutoClip: 结果已保存 (skipped, status=${status})`);
      } else {
        logger.info(`AutoClip: 结果已保存 (${result.highlights.length} highlights, status=${status})`);
      }

      if (!result.skipped && !skipAutoExport && !reviewMode && (videoCutCfg.autoClipExport ?? false) && result.highlights.length > 0) {
        // Fire-and-forget to avoid blocking DB persist response.
        // Errors are logged internally by autoExportAndUpload.
        this.autoExportAndUpload(
          result.id,
          videoPath,
          danmuPath,
          result.highlights,
          presetConfig,
          appConfig,
        ).catch((err) => {
          logger.error("AutoClip: autoExportAndUpload failed", err);
        });
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

    const presetCtx = await resolveExportPresets(exportCfg);
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

}
