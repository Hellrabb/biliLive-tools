import CommonPreset from "./preset.js";

import type { AutoClipConfig } from "@biliLive-tools/types";

export const AUTO_CLIP_DEFAULT_CONFIG: AutoClipConfig = {
  signal: {
    danmakuDensityThreshold: 2.5,
    scMinAmount: 30,
    giftBurstThreshold: 10,
    giftBurstWindowSec: 30,
    windowPadding: [30, 30],
    minWindowDuration: 60,
    maxWindowDuration: 300,
    bucketSec: 10,
    mergeGapSec: 30,
    brushSimilarityThreshold: 0.8,
  },
  llm: {
    enabled: true,
    provider: "qwen",
    modelId: "",
    maxTokens: 1000,
    topK: 5,
    maxCandidatesPerVideo: 15,
    danmakuSampleMax: 200,
  },
  enhancement: {
    asrEnabled: false,
    visualEnabled: false,
  },
  export: {
    cutFormat: "mp4",
    ffmpegPresetId: "default",
    burnDanmaku: false,
    uploadToBili: false,
    savePath: "",
    namingTemplate: "{{title}}_{{index}}_{{highlight_name}}",
  },
};

export class AutoClipPreset extends CommonPreset<AutoClipConfig> {
  constructor(filepath: string) {
    super(filepath, AUTO_CLIP_DEFAULT_CONFIG);
  }
}
