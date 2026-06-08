import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import logger from "../utils/log.js";
import { runAutoClipPipeline, exportClips, resolveExportPresets } from "./pipeline.js";
import { buildSendMessage, buildSendMultimodalMessage } from "./sendMessage.js";
import { AUTO_CLIP_DEFAULT_CONFIG } from "../presets/autoClipPreset.js";
import { autoClipModel } from "../db/index.js";
import { cloneDeep } from "lodash-es";

import { renderTitleTemplate, renderDescTemplate } from "./templateRenderer.js";
import { sampleFrames } from "./frameSampler.js";

import type { AutoClipConfig, AutoClipPreset as AutoClipPresetType } from "@biliLive-tools/types";
import type { AutoClipResult, HighlightSegment } from "./types.js";
import type { ProgressCallback } from "./pipeline.js";

export interface AutoClipServiceDeps {
  getAppConfig: () => {
    ai: {
      models: Array<{ modelId: string; modelName?: string; vendorId?: string; tags?: string[] }>;
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
    /** AbortSignal for cancellation */
    signal?: AbortSignal;
  }): Promise<AutoClipResult> {
    const {
      videoPath,
      danmuPath,
      presetId,
      recorderId,
      skipAutoExport,
      onProgress,
      id,
      outputName,
      signal,
    } = params;

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

    // Build boundary-refine-specific sendMessage (Phase 1.6), fallback to main sendMessage.
    // Uses a longer timeout (180s) because the boundary refinement prompt bundles ASR+frame
    // data for ALL highlights into a single LLM call, which can be very large.
    let sendBoundaryRefineMessage: typeof sendMessage;
    if (presetConfig.llm.boundaryRefineModelId) {
      sendBoundaryRefineMessage = await buildSendMessage({
        presetConfig,
        aiConfig: appConfig.ai,
        overrideModelId: presetConfig.llm.boundaryRefineModelId,
        timeoutMs: 180_000,
      });
    }

    // Build multimodal message sender for Phase 1.5 frame description
    const sendMultimodalMessage = await buildSendMultimodalMessage({
      llmConfig: presetConfig.llm,
      aiConfig: appConfig.ai,
    });

    // Build ASR recognize function for Phase 1.5 speech-to-text
    let recognizeASR:
      | ((audioPath: string, signal?: AbortSignal) => Promise<{ text: string }>)
      | undefined;
    if (presetConfig.enhancement?.asrEnabled) {
      try {
        const { recognize } = await import("../ai/asr/index.js");
        // Prefer explicit asrModelId, then auto-discover an ASR-tagged model,
        // then fall back to llm.modelId (legacy behavior).
        let asrModelId = presetConfig.llm.asrModelId;
        if (!asrModelId) {
          const asrModel = appConfig.ai.models.find((m) => m.tags?.includes("asr"));
          asrModelId = asrModel?.modelId ?? presetConfig.llm.modelId;
          if (asrModel) {
            logger.info(
              `AutoClip: auto-discovered ASR model "${asrModel.modelName}" (${asrModelId})`,
            );
          }
        }
        recognizeASR = async (audioPath: string, _signal?: AbortSignal) => {
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

    // H2: Compute effective ID before pipeline so cancel response always returns a valid ID.
    // The pipeline uses `params.id ?? uuidv4()` internally, but we need to know the ID
    // for the catch block (cancel path) before the pipeline resolves.
    const effectiveId = id ?? uuidv4();

    // L5: Snapshot videoCut config values BEFORE pipeline to avoid inconsistent behavior
    // if user changes settings during a long-running pipeline.
    const videoCutCfg = appConfig.videoCut ?? {};
    const reviewMode = videoCutCfg.autoClipReviewMode ?? true;
    const autoExportEnabled = videoCutCfg.autoClipExport ?? false;
    const autoUploadEnabled = videoCutCfg.autoClipUpload ?? false;

    // 3. Run pipeline
    let result: AutoClipResult;
    try {
      result = await runAutoClipPipeline({
        videoPath,
        danmuPath,
        presetConfig,
        sendMessage,
        sendBoundaryRefineMessage,
        sendMultimodalMessage,
        recognizeASR,
        onProgress,
        id: effectiveId,
        ffmpegPath: sysFfmpegPath,
        signal,
      });
    } catch (err: unknown) {
      // M6: Capture error immediately to avoid TOCTOU race — if abort fires
      // between throw and catch, we must NOT swallow a real non-abort error.
      const capturedErr = err;
      // Only treat as cancel if the error IS an AbortError thrown by signal.throwIfAborted()
      const isAbortError = capturedErr instanceof Error && capturedErr.name === "AbortError";
      if (isAbortError && signal?.aborted) {
        return {
          id: effectiveId,
          videoPath,
          danmuPath,
          highlights: [],
          suspiciousPatterns: [],
          skipped: true,
          skippedReason: "cancelled",
          llmFallback: false,
        };
      }
      // M6: Real errors are re-thrown even if signal fired between throw and catch
      throw capturedErr;
    }

    // Persist newly auto-detected filter rules back to preset.
    // Uses atomic append to minimize read-modify-write race window.
    const activePresetId = presetId || appConfig.videoCut?.autoClipPresetId;
    if (activePresetId && result.autoGeneratedRules && result.autoGeneratedRules.length > 0) {
      try {
        const { container } = await import("../index.js");
        const autoClipPreset = container.resolve("autoClipPreset");

        // Validate that auto-generated rules have valid structure
        const isValidRule = (r: unknown): boolean =>
          typeof r === "object" &&
          r !== null &&
          typeof (r as Record<string, unknown>).pattern === "string" &&
          typeof (r as Record<string, unknown>).mode === "string";

        if (!result.autoGeneratedRules.every(isValidRule)) {
          logger.warn("AutoClip: skipping rule persistence — generated rules have invalid shape");
        } else {
          const inserted = await autoClipPreset.appendFilterRules(
            activePresetId,
            result.autoGeneratedRules.map((r) => ({
              pattern: r.pattern,
              mode: r.mode,
              source: "auto" as const,
              enabled: true,
            })),
          );
          if (inserted > 0) {
            logger.info(`AutoClip: saved ${inserted} new filter rules to preset ${activePresetId}`);
          }
        }
      } catch (e) {
        logger.warn("AutoClip: failed to persist new filter rules to preset", e);
      }
    }

    // 4. Persist to DB — always upsert to overwrite any /run placeholder
    // L5: Use snapshots captured before pipeline, not re-reading from appConfig
    const status = reviewMode ? "pending" : "approved";

    try {
      // Preserve output_name from existing placeholder (for async manual analysis)
      let effectiveOutputName = outputName ?? null;
      if (id && !effectiveOutputName) {
        const existing = autoClipModel.getResultById(id);
        effectiveOutputName = existing?.output_name ?? null;
      }
      const highlightsJson = JSON.stringify(result.highlights);
      const evidenceJson = result.evidence ? JSON.stringify(result.evidence) : null;
      let highlightCount = 0;
      let firstTitle: string | null = null;
      try {
        const parsed = result.highlights;
        if (Array.isArray(parsed) && parsed.length > 0) {
          highlightCount = parsed.length;
          firstTitle = parsed[0]?.title || null;
        }
      } catch {
        /* keep defaults */
      }

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
        retry_count: 0,
        evidence: evidenceJson,
      });

      if (result.skipped) {
        logger.info(`AutoClip: 结果已保存 (skipped, status=${status})`);
      } else {
        logger.info(
          `AutoClip: 结果已保存 (${result.highlights.length} highlights, status=${status})`,
        );
      }

      if (
        !result.skipped &&
        !skipAutoExport &&
        !reviewMode &&
        autoExportEnabled &&
        result.highlights.length > 0
      ) {
        // Fire-and-forget to avoid blocking DB persist response.
        // Errors are logged internally by autoExportAndUpload.
        this.autoExportAndUpload(
          result.id,
          videoPath,
          danmuPath,
          result.highlights,
          presetConfig,
          appConfig,
          autoUploadEnabled,
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
    autoUploadEnabled: boolean,
  ) {
    try {
      const exportCfg = presetConfig.export;
      const { resolveSavePath } = await import("./exportPipeline.js");
      const savePath = resolveSavePath(exportCfg, videoPath);

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

      // Log danmaku status for diagnostics
      if (exportResult.danmakuStatus === "failed") {
        logger.warn(`AutoClip: 弹幕渲染失败 — ${exportResult.danmakuError}`);
      } else if (exportResult.danmakuStatus === "skipped" && exportResult.danmakuError) {
        logger.warn(`AutoClip: 弹幕渲染跳过 — ${exportResult.danmakuError}`);
      }

      if (exportResult.success.length > 0) {
        autoClipModel.markExported(
          resultId,
          exportResult.success.map((s) => s.path),
        );
        logger.info(`AutoClip: 导出完成 ${exportResult.success.length} 个文件`);

        if (exportResult.failed.length > 0) {
          logger.warn(`AutoClip: ${exportResult.failed.length} 个切片导出失败`);
        }

        // L5: autoUploadEnabled is snapshot from pipeline start
        // Global autoClipUpload is the master switch; preset export.uploadToBili is per-preset gate
        if (autoUploadEnabled && (presetConfig.export.uploadToBili ?? false)) {
          await this.uploadToBili(exportResult.success, appConfig, presetConfig, videoPath);
        }

        try {
          const { sendNotify } = await import("../notify.js");
          await sendNotify(
            "autoClip 切片完成",
            `录制 ${path.basename(videoPath)} 自动切片完成，共 ${exportResult.success.length} 个高光片段`,
          );
        } catch {
          // notification may not be configured
        }
      } else if (exportResult.failed.length > 0) {
        autoClipModel.updateStatus(resultId, "failed");
        logger.error(`AutoClip: 全部导出失败 (${exportResult.failed.length} 个片段)`);
      } else {
        logger.warn("AutoClip: export produced no results (both success and failed are empty)");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`AutoClip: autoExportAndUpload 失败 — ${msg}`);
      try {
        autoClipModel.updateStatus(resultId, "failed");
      } catch {
        /* ignore DB errors during rollback */
      }
    }
  }

  private async uploadToBili(
    exportedResults: { path: string; highlight: HighlightSegment }[],
    appConfig: ReturnType<AutoClipServiceDeps["getAppConfig"]>,
    presetConfig: AutoClipConfig,
    videoPath: string,
  ) {
    try {
      const biliApi = (await import("../task/bili.js")).default;
      const { DEFAULT_BILIUP_CONFIG } = await import("../presets/videoPreset.js");

      const uid = appConfig.uid;
      if (!uid) {
        logger.warn("AutoClip: 未配置默认B站UID，跳过自动上传");
        return;
      }

      // Build template context
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const ctx = {
        highlightTitle: "", // filled per-highlight below
        roomName: path.basename(path.dirname(videoPath)) || "",
        date: todayStr,
        uploadDate: todayStr,
      };

      // Read biliUpTemplate from autoclip preset, with field-level defaults
      const tpl = presetConfig.export.biliUpTemplate;
      const titleTemplate = tpl?.titleTemplate || "{{highlightTitle}}";
      const descTemplate = tpl?.descTemplate || "";
      const tag = tpl?.tag?.length ? tpl.tag : DEFAULT_BILIUP_CONFIG.tag;
      const tid = tpl?.tid ?? DEFAULT_BILIUP_CONFIG.tid;
      const copyright = tpl?.copyright ?? DEFAULT_BILIUP_CONFIG.copyright;
      const source = tpl?.source ?? DEFAULT_BILIUP_CONFIG.source;
      const noReprint = tpl?.noReprint;
      const coverPath = tpl?.cover || "";

      for (const { path: expPath, highlight } of exportedResults) {
        ctx.highlightTitle = highlight?.title || path.parse(expPath).name;

        const title = renderTitleTemplate(titleTemplate, ctx);
        const desc = descTemplate
          ? renderDescTemplate(descTemplate, ctx)
          : DEFAULT_BILIUP_CONFIG.desc;

        // Auto cover extraction: use bestRange midpoint if no manual cover
        let resolvedCover = coverPath;
        if (!resolvedCover) {
          try {
            const bestRange = highlight.bestRange ?? highlight.timeRange;
            const midSec = bestRange[0] + (bestRange[1] - bestRange[0]) / 2;
            const frames = await sampleFrames(videoPath, [midSec]);
            if (frames.length > 0 && frames[0]) {
              const fs = await import("node:fs/promises");
              const coverFile = path.join(
                path.dirname(expPath),
                `${path.parse(expPath).name}_cover.jpg`,
              );
              await fs.writeFile(coverFile, Buffer.from(frames[0], "base64"));
              resolvedCover = coverFile;
            }
          } catch (coverErr) {
            logger.warn("AutoClip: 封面自动提取失败，将不上传封面", coverErr);
          }
        }

        await biliApi.addMedia(
          [{ path: expPath, title }],
          {
            ...DEFAULT_BILIUP_CONFIG,
            title,
            desc,
            tag,
            tid,
            copyright,
            source,
            ...(noReprint !== undefined ? { noReprint } : {}),
            ...(resolvedCover ? { cover: resolvedCover } : {}),
          },
          uid,
        );
      }
      logger.info(`AutoClip: 已添加 ${exportedResults.length} 个B站上传任务到队列`);
    } catch (uploadError) {
      logger.error("AutoClip: 自动上传B站失败", uploadError);
    }
  }
}
