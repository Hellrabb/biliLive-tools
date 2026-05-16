import CommonPreset from "./preset.js";

import type { AutoClipConfig, GlobalConfig } from "@biliLive-tools/types";

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
    danmakuSampleMax: 20,
      contextWindowSec: 30,
      titleStylePrompt: "",
      titleStyleConfig: {
        maxLength: 30,
        minLength: 20,
      },
  },
  enhancement: {
    asrEnabled: false,
    visualEnabled: false,
    boundaryRefineEnabled: true,
  },
  export: {
    cutFormat: "mp4",
    encoder: "libx264",
    audioCodec: "copy",
    ffmpegPresetId: "default",
    burnDanmaku: false,
    danmuPresetId: "default",
    uploadToBili: false,
    savePath: "",
    namingTemplate: "{{title}}_{{index}}",
  },
  danmakuFilter: {
    enabled: true,
    rules: [],
    autoDetectEnabled: true,
  },
};

export class AutoClipPreset extends CommonPreset<AutoClipConfig> {
  constructor({ globalConfig }: { globalConfig: Pick<GlobalConfig, "autoClipPresetPath"> }) {
    super(globalConfig.autoClipPresetPath, AUTO_CLIP_DEFAULT_CONFIG);
  }

  /**
   * Atomically append danmaku filter rules to a preset.
   * Only inserts rules whose pattern is not already present.
   * Returns the count of newly inserted rules.
   */
  async appendFilterRules(
    presetId: string,
    newRules: Array<{ pattern: string; mode: "exact" | "contains" | "regex"; source: "auto"; enabled: boolean }>,
  ): Promise<number> {
    const existing = await this.get(presetId);
    if (!existing) return 0;

    const existingPatterns = new Set(
      (existing.config.danmakuFilter?.rules ?? []).map((r) => r.pattern),
    );
    const toInsert = newRules.filter((r) => !existingPatterns.has(r.pattern));
    if (toInsert.length === 0) return 0;

    const now = Date.now();
    const { v4: uuidv4 } = await import("uuid");
    const rules = toInsert.map((r) => ({ ...r, id: uuidv4(), createdAt: now }));

    const updatedConfig = {
      ...existing.config,
      danmakuFilter: {
        ...existing.config.danmakuFilter,
        rules: [...(existing.config.danmakuFilter?.rules ?? []), ...rules],
      },
    };
    await this.save({ id: presetId, name: existing.name, config: updatedConfig });
    return rules.length;
  }
}
