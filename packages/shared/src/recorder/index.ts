import fs from "fs-extra";
import path from "node:path";
import axios from "axios";
import { cloneDeep, omit } from "lodash-es";

import { provider as providerForDouYu } from "@bililive-tools/douyu-recorder";
import { provider as providerForHuYa } from "@bililive-tools/huya-recorder";
import { provider as providerForBiliBili } from "@bililive-tools/bilibili-recorder";
import { provider as providerForDouYin } from "@bililive-tools/douyin-recorder";
import { provider as providerForXHS } from "@bililive-tools/xhs-recorder";

import {
  createRecorderManager as createManager,
  setFFMPEGPath,
  setMesioPath,
  setBililivePath,
  utils,
} from "@bililive-tools/manager";

import recordHistory from "./recordHistory.js";
import { danmuService } from "../db/index.js";
// import DanmuService from "../db/service/danmuService.js";
import { getBinPath, readVideoMeta } from "../task/video.js";
import logger from "../utils/log.js";
import { replaceExtName, calculateFileQuickHash } from "../utils/index.js";
import RecorderConfig from "./config.js";
import { sendBySystem, send } from "../notify.js";
import { danmaReport, parseDanmu } from "../danmu/index.js";

import type { AppConfig } from "../config.js";
import type {
  Recorder as RecorderConfigType,
  AppConfig as AppConfigType,
} from "@biliLive-tools/types";
import type { Recorder } from "@bililive-tools/manager";

export { RecorderConfig };

// 缓存直播结束通知的最后触发时间，避免频繁通知
const endLiveNotificationCache = new Map<string, number>();

async function buildSendMessageForAutoClip(
  appConfig: AppConfig,
  presetConfig: { llm: { enabled: boolean; provider: string; modelId: string } },
): Promise<((prompt: string) => Promise<string>) | undefined> {
  const llmCfg = presetConfig.llm;
  if (!llmCfg.enabled) return undefined;

  const cfg = appConfig.getAll();
  const aiConfig = cfg?.ai;
  if (!aiConfig) return undefined;

  const model = aiConfig.models.find((m: any) => m.modelId === llmCfg.modelId);
  const vendor = aiConfig.vendors.find((v: any) => v.id === model?.vendorId);

  if (llmCfg.provider === "qwen") {
    const { QwenLLM } = await import("../ai/llm/qwen.js");
    const llm = new QwenLLM({
      apiKey: vendor?.apiKey ?? "",
      model: model?.modelName,
      baseURL: vendor?.baseURL,
    });
    return async (prompt: string) => {
      const result = await llm.sendMessage(prompt);
      return result.content;
    };
  }

  if (llmCfg.provider === "ollama") {
    const { chat } = await import("../llm/ollama.js");
    return async (prompt: string) => {
      const result = await chat({
        host: vendor?.baseURL ?? "http://localhost:11434",
        model: model?.modelName ?? "qwen2.5",
        messages: [{ role: "user", content: prompt }],
      });
      return result?.message?.content ?? "";
    };
  }

  logger.warn(`AutoClip: unknown LLM provider "${llmCfg.provider}", falling back to heuristic ranking`);
  return undefined;
}

async function sendStartLiveNotification(
  appConfig: AppConfig,
  recorder: Recorder,
  config: RecorderConfigType,
) {
  const name = recorder?.liveInfo?.owner ? recorder.liveInfo.owner : config.remarks;
  const title = `${name}(${config.channelId}) 正在直播`;

  const globalConfig = appConfig.getAll();
  let notifyType = globalConfig?.notification?.setting?.type;
  if (globalConfig?.notification?.taskNotificationType["liveStart"]) {
    notifyType = globalConfig?.notification?.taskNotificationType["liveStart"];
  }

  if (notifyType === "system") {
    const event = await sendBySystem(title, `${recorder?.liveInfo?.title}\n点击打开直播间`);
    const { shell } = await import("electron");
    event?.on("click", () => {
      const url = recorder.getChannelURL();
      shell.openExternal(url);
    });
  } else {
    await send(title, `标题：${recorder?.liveInfo?.title}`, { type: "liveStart" });
  }
}

async function sendEndLiveNotification(
  appConfig: AppConfig,
  recorder: Recorder,
  config: RecorderConfigType,
) {
  const cacheKey = `${recorder.providerId}_${recorder.id}`;
  const now = Date.now();
  const lastNotificationTime = endLiveNotificationCache.get(cacheKey);

  // 如果距离上次通知不到10分钟，跳过
  if (lastNotificationTime && now - lastNotificationTime < 10 * 60 * 1000) {
    logger.info(
      `跳过直播结束通知，距离上次通知不到10分钟：${config.remarks} (${config.channelId})`,
    );
    return;
  }

  const name = recorder?.liveInfo?.owner ? recorder.liveInfo.owner : config.remarks;
  const title = `${name}(${config.channelId}) 录制已停止`;

  const globalConfig = appConfig.getAll();
  let notifyType = globalConfig?.notification?.setting?.type;
  if (globalConfig?.notification?.taskNotificationType["liveStart"]) {
    notifyType = globalConfig?.notification?.taskNotificationType["liveStart"];
  }

  if (notifyType === "system") {
    sendBySystem(title, "");
  } else {
    await send(title, `标题：${recorder?.liveInfo?.title}`, { type: "liveStart" });
  }

  // 更新最后通知时间
  endLiveNotificationCache.set(cacheKey, now);
}

export async function createRecorderManager(appConfig: AppConfig) {
  /**
   * 更新录制器
   * @param args - 更新参数
   * @returns 更新后的录制器
   */
  async function updateRecorder(
    recorder: Recorder,
    args: Omit<RecorderConfigType, "channelId" | "providerId">,
  ) {
    const cloneArgs = cloneDeep(args);
    // 不更新extra字段，可能包含运行时数据
    // @ts-ignore
    delete cloneArgs.extra;
    Object.assign(recorder, { ...omit(cloneArgs, ["id"]) });
    return recorder;
  }

  /**
   * 构建manager配置项
   */
  async function buildManagerOptions(config: AppConfigType) {
    const savePathRule = path.join(config?.recorder?.savePath, config?.recorder?.nameRule);
    const autoCheckInterval = config?.recorder?.checkInterval ?? 60;
    const maxThreadCount = config?.recorder?.maxThreadCount ?? 3;
    const waitTime = config?.recorder?.waitTime ?? 0;

    // 构建每个平台的检查配置
    const providerCheckConfig: Record<
      string,
      {
        autoCheckInterval?: number;
        maxThreadCount?: number;
        waitTime?: number;
      }
    > = {
      [providerForBiliBili.id]: {
        autoCheckInterval: (config?.recorder?.bilibili.checkInterval ?? autoCheckInterval) * 1000,
        maxThreadCount: config?.recorder?.bilibili.maxThreadCount ?? maxThreadCount,
        waitTime: config?.recorder?.bilibili.waitTime ?? waitTime,
      },
      [providerForDouYu.id]: {
        autoCheckInterval: (config?.recorder?.douyu.checkInterval ?? autoCheckInterval) * 1000,
        maxThreadCount: config?.recorder?.douyu.maxThreadCount ?? maxThreadCount,
        waitTime: config?.recorder?.douyu.waitTime ?? waitTime,
      },
      [providerForHuYa.id]: {
        autoCheckInterval: (config?.recorder?.huya.checkInterval ?? autoCheckInterval) * 1000,
        maxThreadCount: config?.recorder?.huya.maxThreadCount ?? maxThreadCount,
        waitTime: config?.recorder?.huya.waitTime ?? waitTime,
      },
      [providerForDouYin.id]: {
        autoCheckInterval: (config?.recorder?.douyin.checkInterval ?? autoCheckInterval) * 1000,
        maxThreadCount: config?.recorder?.douyin.maxThreadCount ?? maxThreadCount,
        waitTime: config?.recorder?.douyin.waitTime ?? waitTime,
      },
      [providerForXHS.id]: {
        autoCheckInterval: (config?.recorder?.xhs.checkInterval ?? autoCheckInterval) * 1000,
        maxThreadCount: config?.recorder?.xhs.maxThreadCount ?? maxThreadCount,
        waitTime: config?.recorder?.xhs.waitTime ?? waitTime,
      },
    };

    return {
      providers: [
        providerForDouYu,
        providerForHuYa,
        providerForBiliBili,
        providerForDouYin,
        providerForXHS,
      ],
      autoRemoveSystemReservedChars: true,
      autoCheckInterval: autoCheckInterval * 1000,
      savePathRule: savePathRule,
      biliBatchQuery: config?.recorder?.bilibili.useBatchQuery ?? false,
      recordRetryImmediately: config?.recorder?.recordRetryImmediately ?? false,
      maxThreadCount: maxThreadCount,
      waitTime: waitTime,
      providerCheckConfig,
    };
  }

  /**
   * 全局配置更新后，更新录制器相关参数
   */
  async function updateRecorderManager(
    manager: ReturnType<typeof createManager>,
    appConfig: AppConfig,
  ) {
    const config = appConfig.getAll();
    const savePathRule = path.join(config?.recorder?.savePath, config?.recorder?.nameRule);
    const autoCheckInterval = config?.recorder?.checkInterval ?? 60;
    const maxThreadCount = config?.recorder?.maxThreadCount ?? 3;
    const waitTime = config?.recorder?.waitTime ?? 0;
    const autoCheckLiveStatusAndRecord = config?.recorder?.autoRecord ?? false;

    manager.autoCheckInterval = autoCheckInterval * 1000;
    manager.maxThreadCount = maxThreadCount;
    manager.waitTime = waitTime;
    manager.savePathRule = savePathRule;
    manager.biliBatchQuery = config?.recorder?.bilibili.useBatchQuery ?? false;
    manager.recordRetryImmediately = config?.recorder?.recordRetryImmediately ?? false;

    const managerOptions = await buildManagerOptions(config);

    // 更新每个平台的检查配置
    manager.providerCheckConfig = managerOptions.providerCheckConfig;

    if (autoCheckLiveStatusAndRecord) {
      if (autoCheckLiveStatusAndRecord && !manager.isCheckLoopRunning) {
        manager.startCheckLoop();
      }

      if (!autoCheckLiveStatusAndRecord && manager.isCheckLoopRunning) {
        manager.stopCheckLoop();
      }
    }

    for (const recorderOpts of recorderConfig.list()) {
      try {
        const recorder = manager.recorders.find((item) => item.id === recorderOpts.id);
        if (recorder == null) continue;

        await updateRecorder(recorder, recorderOpts);
      } catch (error) {
        logger.error("updateRecorderManager error", error);
        continue;
      }
    }
  }

  const config = appConfig.getAll();
  const { ffmpegPath, mesioPath, bililiveRecorderPath } = getBinPath();
  setFFMPEGPath(ffmpegPath);
  setMesioPath(mesioPath);
  setBililivePath(bililiveRecorderPath);

  const autoCheckLiveStatusAndRecord = config?.recorder?.autoRecord ?? false;

  const managerOptions = await buildManagerOptions(config);
  const manager = createManager(managerOptions);

  manager.on("RecorderDebugLog", ({ recorder, ...log }) => {
    if (log.type !== "ffmpeg") {
      logger.info(`recorder: ${log.text}`);
    }
    const debugMode = recorder.debugLevel !== "none";
    if (!debugMode) return;

    if (recorder.recordHandle) {
      const logFilePath = utils.replaceExtName(
        `${recorder.recordHandle.savePath}_${recorder.id}`,
        ".recorder.log",
      );
      fs.appendFile(logFilePath, log.text + "\n").catch(() => {});
      return;
    } else {
      logger.info(`recorder: ${log.text}`);
    }
  });
  manager.on("RecordStart", ({ recorder, recordHandle }) => {
    logger.info("Manager start", recorder, recordHandle);
    if (!recorder.extra) recorder.extra = {};
    const timestamp = Date.now();
    recorder.extra.lastRecordTime = timestamp;
  });
  manager.on("RecordStop", ({ recorder }) => {
    logger.info("Manager stop", recorder);
    // 录制结束通知，自动监听&开启推送时才会发送
    const config = recorderConfig.get(recorder.id);
    if (!config) return;
    if (config?.liveEndNotification && !config?.disableAutoCheck) {
      setTimeout(
        () => {
          const trueRecorder = manager.getRecorder(recorder.id);
          if (!trueRecorder) return;
          if (trueRecorder?.recordHandle) return;
          sendEndLiveNotification(appConfig, trueRecorder, config);
        },
        1000 * 60 * 3,
      );
    }
  });
  manager.on("error", (error) => {
    logger.error("Manager error", error);
  });
  manager.on("RecoderLiveStart", async ({ recorder }) => {
    // 录制开始通知，自动监听&开启推送时才会发送
    const config = recorderConfig.get(recorder.id);
    if (!config) return;
    if (config?.liveStartNotification && !config?.disableAutoCheck) {
      sendStartLiveNotification(appConfig, recorder, config);
    }
  });
  // manager.on("RecordSegment", (debug) => {
  //   console.error("Manager segment", debug);
  // });
  manager.on("videoFileCreated", async ({ recorder, filename, rawFilename }) => {
    logger.info("Manager videoFileCreated", { recorder, filename, rawFilename });
    const videoStartTime = new Date();
    const liveStartTime = recorder.liveInfo?.liveStartTime;

    if (!recorder.liveInfo) {
      logger.error("Manager videoFileCreated Error", { recorder, filename, rawFilename });
      return;
    }
    const data = recorderConfig.get(recorder.id);

    data?.sendToWebhook &&
      axios.post(
        `http://127.0.0.1:${config.port}/webhook/custom`,
        {
          event: "FileOpening",
          filePath: filename,
          roomId: recorder.channelId,
          time: videoStartTime.toISOString(),
          title: recorder.liveInfo.title,
          username: recorder.liveInfo.owner,
          platform: recorder.providerId.toLowerCase(),
          software: "biliLive-tools",
        },
        {
          proxy: false,
        },
      );

    recordHistory.addWithStreamer({
      live_start_time: liveStartTime?.getTime(),
      live_id: recorder?.liveInfo?.liveId,
      record_start_time: videoStartTime.getTime(),
      room_id: recorder.channelId,
      title: recorder.liveInfo.title,
      video_file: filename,
      name: recorder.liveInfo.owner,
      platform: recorder.providerId,
    });
  });
  manager.on("videoFileCompleted", async ({ recorder, filename, stats }) => {
    logger.info("Manager videoFileCompleted", { recorder, filename, stats });

    const endTime = new Date();
    const data = recorderConfig.get(recorder.id);
    const title = recorder?.liveInfo?.title;
    const username = recorder?.liveInfo?.owner;
    const channelId = recorder?.channelId;
    const liveId = recorder?.liveInfo?.liveId;
    const config = appConfig.getAll();

    try {
      const xmlFile = replaceExtName(filename, ".xml");
      const videoMeta = await readVideoMeta(filename);
      const duration = videoMeta?.format?.duration ?? 0;

      // 提取文件名（不含后缀）
      const videoFilename = path.basename(filename, path.extname(filename));

      // 计算文件快速哈希值
      let quickHash: string | undefined;
      try {
        quickHash = await calculateFileQuickHash(filename);
      } catch (error) {
        logger.error("计算文件quickHash失败", { filename, error });
      }

      recordHistory.upadteLive(
        {
          video_file: filename,
          live_id: liveId,
        },
        {
          record_end_time: endTime.getTime(),
          video_duration: isNaN(Number(duration)) ? 0 : Math.floor(duration),
          video_filename: videoFilename,
          quick_hash: quickHash,
        },
      );

      if (stats) {
        recordHistory.upadteLive(
          {
            video_file: filename,
            live_id: liveId,
          },
          {
            danma_num: stats.danmaNum,
            interact_num: stats.uniqMember,
          },
        );
      } else if (xmlFile && (await fs.pathExists(xmlFile))) {
        const { uniqMember, danmaNum } = await danmaReport(xmlFile);
        recordHistory.upadteLive(
          {
            video_file: filename,
            live_id: liveId,
          },
          {
            danma_num: danmaNum,
            interact_num: uniqMember,
          },
        );
      }
    } catch (error) {
      logger.error("Update live error", { recorder, filename, error });
    } finally {
      if (data?.sendToWebhook) {
        const webhookUrl = `http://127.0.0.1:${config.port}/webhook/custom`;
        const payload = {
          event: "FileClosed",
          filePath: filename,
          roomId: channelId,
          time: endTime.toISOString(),
          title: title,
          username: username,
          platform: recorder.providerId.toLowerCase(),
          software: "biliLive-tools",
        };

        logger.debug("Manager videoFileCompleted webhook start", {
          recorderId: recorder.id,
          webhookUrl,
          filePath: filename,
          roomId: channelId,
          hasTitle: Boolean(title),
          hasUsername: Boolean(username),
        });

        try {
          await axios.post(webhookUrl, payload, {
            proxy: false,
            timeout: 10000,
          });
          logger.debug("Manager videoFileCompleted webhook success", {
            recorderId: recorder.id,
            webhookUrl,
            filePath: filename,
          });
        } catch (error) {
          if (axios.isAxiosError(error)) {
            logger.error("Manager videoFileCompleted webhook error", {
              recorderId: recorder.id,
              webhookUrl,
              filePath: filename,
              code: error.code,
              message: error.message,
              status: error.response?.status,
              data: error.response?.data,
            });
          } else {
            logger.error("Manager videoFileCompleted webhook error", {
              recorderId: recorder.id,
              webhookUrl,
              filePath: filename,
              error,
            });
          }
        }
      }
    }

    const xmlFile = replaceExtName(filename, ".xml");
    if (config.recorder.saveDanma2DB && xmlFile && (await fs.pathExists(xmlFile))) {
      const history = recordHistory.getRecord({
        file: filename,
        live_id: liveId,
      });
      if (!history) return;
      logger.info("写入弹幕文件：", xmlFile);
      const { danmu, sc, gift, guard } = await parseDanmu(replaceExtName(filename, ".xml"));
      const result: {
        record_id: number;
        ts: number;
        type: "text" | "gift";
        user?: string;
        gift_price?: number;
        gift_name?: string;
        text: string;
      }[] = [];

      for (const item of danmu) {
        result.push({
          record_id: history.id,
          ts: item.timestamp!,
          type: item.type,
          user: item.user,
          gift_price: undefined,
          text: item.text ?? "",
          gift_name: "",
        });
      }
      for (const item of sc) {
        result.push({
          record_id: history.id,
          ts: item.timestamp!,
          type: "gift",
          user: item.user,
          gift_price: item.gift_price,
          text: item.text ?? "",
          gift_name: "SC",
        });
      }
      for (const item of gift) {
        result.push({
          record_id: history.id,
          ts: item.timestamp!,
          type: item.type,
          user: item.user,
          gift_price: Number(item.gift_price) * Number(item.gift_count),
          text: "",
          gift_name: item.gift_name,
        });
      }
      for (const item of guard) {
        result.push({
          record_id: history.id,
          ts: item.timestamp!,
          type: "gift",
          user: item.user,
          gift_price: Number(item.gift_price) * Number(item.gift_count),
          text: "",
          gift_name: item.gift_name,
        });
      }
      danmuService.addMany(result, {
        platform: recorder.providerId,
        roomId: recorder.channelId,
      });
    }

    // 6. AutoClip: 录制完成后根据配置自动触发
    try {
      const xmlFile = replaceExtName(filename, ".xml");
      if (xmlFile && (await fs.pathExists(xmlFile))) {
        // 读取 autoClip 配置
        const cfg = appConfig.getAll();
        const videoCutCfg = cfg?.videoCut ?? {};
        const autoClipEnabled = videoCutCfg.autoClipEnabled ?? false;

        if (!autoClipEnabled) {
          logger.info("AutoClip: 全局开关未开启，跳过");
          return;
        }

        // 检查时间窗口
        const tw = videoCutCfg.autoClipTimeWindow;
        if (tw?.enabled) {
          const now = new Date();
          const currentMinutes = now.getHours() * 60 + now.getMinutes();
          const [sh, sm] = tw.start.split(":").map(Number);
          const [eh, em] = tw.end.split(":").map(Number);
          const startMin = sh * 60 + sm;
          const endMin = eh * 60 + em;
          if (currentMinutes < startMin || currentMinutes > endMin) {
            logger.info(`AutoClip: 不在时间窗口内 (${tw.start}-${tw.end})，跳过`);
            return;
          }
        }

        logger.info("AutoClip: 检查自动切片触发条件", {
          videoPath: filename,
          danmuPath: xmlFile,
        });

        // 加载 preset 配置
        const { runAutoClipPipeline } = await import("../autoClip/pipeline.js");
        const { AUTO_CLIP_DEFAULT_CONFIG } = await import("../presets/autoClipPreset.js");

        let presetConfig = AUTO_CLIP_DEFAULT_CONFIG;
        const presetId = videoCutCfg.autoClipPresetId;
        if (presetId && presetId !== "") {
          try {
            const { container: diContainer } = await import("../index.js");
            const autoClipPreset = diContainer.resolve("autoClipPreset");
            const p = await autoClipPreset.get(presetId);
            presetConfig = p?.config ?? AUTO_CLIP_DEFAULT_CONFIG;
          } catch {
            // fallback to default
          }
        }

        logger.info("AutoClip: 开始自动切片分析", { videoPath: filename, danmuPath: xmlFile });

        // 构建 sendMessage 回调，将 preset 中的 provider/modelId 连接到全局 AI 配置
        const sendMessage = await buildSendMessageForAutoClip(appConfig, presetConfig);

        const result = await runAutoClipPipeline({
          videoPath: filename,
          danmuPath: xmlFile,
          presetConfig,
          sendMessage,
          onProgress: (_stage, _pct, msg) => logger.info(`AutoClip: ${msg}`),
        });

        if (result.skipped) {
          logger.info(`AutoClip: 跳过 — ${result.skippedReason}`);
        } else {
          logger.info(`AutoClip: 检测到 ${result.highlights.length} 个高光片段`);
          for (const h of result.highlights) {
            logger.info(`AutoClip highlight: "${h.title}" (score: ${h.score}, ${h.bestRange[0]}-${h.bestRange[1]}s)`);
          }

          // 持久化到数据库
          const reviewMode = videoCutCfg.autoClipReviewMode ?? true;
          const autoExport = videoCutCfg.autoClipExport ?? false;
          const autoUpload = videoCutCfg.autoClipUpload ?? false;

          try {
            const { autoClipModel } = await import("../db/index.js");

            // Use the recorder's channelId as recorder_id
            const recorderId = recorder?.channelId ?? "";
            const status = reviewMode ? "pending" : "approved";

            autoClipModel.saveResult({
              id: result.id,
              video_path: filename,
              danmu_path: xmlFile,
              recorder_id: String(recorderId),
              preset_id: presetId || null,
              status,
              highlights: JSON.stringify(result.highlights),
              created_at: new Date().toISOString(),
              exported_at: null,
              uploaded_at: null,
              exported_paths: null,
              bili_aids: null,
            } satisfies import("../db/autoClip.js").AutoClipResultRow);

            logger.info(`AutoClip: 结果已保存 (status=${status})`);

            // 非审核模式：自动导出
            if (!reviewMode && autoExport && result.highlights.length > 0) {
              const { exportClips } = await import("../autoClip/pipeline.js");
              logger.info(`AutoClip: 开始自动导出 ${result.highlights.length} 个切片...`);

              const exportConfig = presetConfig.export;
              const savePath = exportConfig.savePath || path.dirname(filename);
              const effectiveConfig = { ...exportConfig, savePath };

              const exportedPaths = await exportClips(
                filename,
                result.highlights,
                effectiveConfig,
                (_stage, _pct, msg) => logger.info(`AutoClip export: ${msg}`),
              );

              if (exportedPaths.length > 0) {
                autoClipModel.markExported(result.id, exportedPaths);
                logger.info(`AutoClip: 导出完成 ${exportedPaths.length} 个文件`);

                // 自动上传B站 (Phase 2 Task 11)
                if (autoUpload) {
                  try {
                    const biliApi = (await import("../task/bili.js")).default;
                    const { DEFAULT_BILIUP_CONFIG } = await import("../presets/videoPreset.js");
                    const { container: diContainer } = await import("../index.js");

                    const cfg = appConfig.getAll();
                    const uid = cfg?.uid;

                    if (!uid) {
                      logger.warn("AutoClip: 未配置默认B站UID，跳过自动上传");
                    } else {
                      // 获取B站上传预设配置，优先使用第一个预设，否则使用默认配置
                      let biliupConfig = DEFAULT_BILIUP_CONFIG;
                      try {
                        const videoPreset = diContainer.resolve("videoPreset");
                        const presets = await videoPreset.list();
                        if (presets.length > 0 && presets[0].config) {
                          biliupConfig = presets[0].config;
                        }
                      } catch {
                        // fallback to default
                      }

                      for (let i = 0; i < exportedPaths.length; i++) {
                        const expPath = exportedPaths[i];
                        const highlight = result.highlights[i];
                        const title = highlight?.title || path.parse(expPath).name;

                        await biliApi.addMedia(
                          [{ path: expPath, title }],
                          { ...biliupConfig, title },
                          uid,
                        );
                      }

                      autoClipModel.markUploaded(result.id, []);
                      logger.info(`AutoClip: 已添加 ${exportedPaths.length} 个B站上传任务到队列`);
                    }
                  } catch (uploadError) {
                    logger.error("AutoClip: 自动上传B站失败", uploadError);
                  }
                }

                // 发送通知
                try {
                  const { sendNotify } = await import("../notify.js");
                  await sendNotify(
                    "autoClip 切片完成",
                    `录制 ${path.basename(filename)} 自动切片完成，共 ${exportedPaths.length} 个高光片段`,
                  );
                } catch {
                  // notification may not be configured
                }
              }
            }
          } catch (dbError) {
            logger.error("AutoClip: 持久化失败", dbError);
          }
        }
      }
    } catch (error) {
      logger.error("AutoClip: 自动切片触发失败", error);
    }
  });

  appConfig.on("update", () => {
    const { ffmpegPath, mesioPath, bililiveRecorderPath } = getBinPath();
    setFFMPEGPath(ffmpegPath);
    setMesioPath(mesioPath);
    setBililivePath(bililiveRecorderPath);
    updateRecorderManager(manager, appConfig);
  });

  const recorderConfig = new RecorderConfig(appConfig);
  for (const recorder of recorderConfig.list()) {
    try {
      manager.addRecorder({
        ...recorder,
        m3u8ProxyUrl: `http://127.0.0.1:${config.port}/bili/stream`,
      });
    } catch (error) {
      logger.error("Add recorder error", { recorder, error });
      continue;
    }
  }

  if (autoCheckLiveStatusAndRecord) manager.startCheckLoop();

  setTimeout(() => {
    // 转异步，避免阻塞
    const data = recordHistory.getLastRecordTimesByChannels(
      manager.recorders.map((r) => ({ channelId: r.channelId, providerId: r.providerId })),
    );
    // console.log("获取上次录制时间完成：", data);
    for (const recorder of manager.recorders) {
      const record = data.find(
        (item) => item.channelId === recorder.channelId && item.providerId === recorder.providerId,
      );
      if (record && record.lastRecordTime) {
        if (!recorder.extra) recorder.extra = {};
        recorder.extra.lastRecordTime = record.lastRecordTime;
      }
    }
  }, 0);

  return {
    manager,
    config: recorderConfig,
    addRecorder: async (recorder: RecorderConfigType) => {
      const recorders = recorderConfig.list();
      if (
        recorders.findIndex(
          (item) =>
            item.channelId === recorder.channelId && item.providerId === recorder.providerId,
        ) !== -1
      ) {
        return null;
      }
      recorderConfig.add(recorder);
      const data = recorderConfig.get(recorder.id);
      if (!data) return null;

      // TODO: 配置可视化
      const recoder = manager.addRecorder({
        ...data,
        m3u8ProxyUrl: `http://127.0.0.1:${config.port}/bili/stream`,
      });

      if (!data.disableAutoCheck) {
        manager.startRecord(recoder.id, {
          ignoreDataLimit: true,
        });
      }
      return recoder;
    },
    updateRecorder: async (args: Omit<RecorderConfigType, "channelId" | "providerId">) => {
      const { id } = args;
      const recorder = manager.recorders.find((item) => item.id === id);
      if (recorder == null) return null;
      recorderConfig.update(args);

      return updateRecorder(recorder, args);
    },
    resolveChannel: async (url: string) => {
      for (const provider of manager.providers) {
        const info = await provider.resolveChannelInfoFromURL(url);
        if (!info) continue;

        return {
          providerId: provider.id,
          channelId: info.id,
          owner: info.owner,
          uid: info.uid,
          avatar: info.avatar,
        };
      }
      return null;
    },
  };
}
