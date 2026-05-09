import type { DanmuItem, SC, Gift, Guard } from "@biliLive-tools/types";

/** 时间窗口 (秒) */
export type TimeWindow = [number, number];

/** 候选窗口, Layer 1 产出 */
export interface CandidateWindow {
  timeRange: TimeWindow;
  signalSources: string[];
  stats: {
    danmakuCount: number;
    danmakuDensity: number;
    scTotal: number;
    scCount: number;
    giftCount: number;
    uniqueUsers: number;
    brushFrequency: number;
  };
  /** 按时间排列的弹幕文本 (窗口内前 N 条去重采样) */
  danmakuSample: DanmuSample[];
  /** SC 摘要 */
  scSummary: SCSummary[];
}

export interface DanmuSample {
  timeOffset: number; // 相对视频起点的秒数
  text: string;
  user?: string;
}

export interface SCSummary {
  user: string;
  amount: number;
  message: string;
}

/** LLM 精排输入: 用于构建 prompt 的候选上下文 */
export interface ClipCandidateContext {
  windowStart: number;
  windowEnd: number;
  danmakuSamples: string[];
  scSummary: SCSummary[];
  stats: CandidateWindow["stats"];
  surroundingBefore: string[];
  surroundingAfter: string[];
}

/** LLM 精排输出 (从 LLM JSON 解析) */
export interface LLMRankResult {
  isHighlight: boolean;
  score: number;
  title: string;
  tags: string[];
  highlightType: "funny" | "impressive" | "touching" | "hype" | "troll" | "not_highlight";
  reason: string;
  bestClipStart: number;
  bestClipEnd: number;
}

/** 高光片段 (Layer 2 最终产出) */
export interface HighlightSegment {
  timeRange: TimeWindow;
  bestRange: TimeWindow;
  score: number;
  title: string;
  tags: string[];
  highlightType: LLMRankResult["highlightType"];
  reason: string;
  signalSources: string[];
  isHighlight: boolean;
}

/** AutoClip pipeline 最终结果 */
export interface AutoClipResult {
  id: string;
  videoPath: string;
  danmuPath: string;
  highlights: HighlightSegment[];
  skipped?: boolean;
  skippedReason?: string;
  /** true if LLM was enabled in config but unavailable — results are heuristic only */
  llmFallback?: boolean;
}

/** 弹幕统计 (parseDanmu 内部结构, 用于信号检测) */
export interface DanmuStats {
  danmu: DanmuItem[];
  sc: SC[];
  gift: Gift[];
  guard: Guard[];
  videoStartTime: number;
  duration: number; // 视频时长秒数
}
