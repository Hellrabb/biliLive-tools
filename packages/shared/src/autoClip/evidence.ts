import type { Evidence, HighlightSegment, BoundaryRefinement } from "./types.js";
import type { DensityBucket } from "./signalDetector.js";

interface BuildEvidenceParams {
  densityBuckets: DensityBucket[];
  highlights: HighlightSegment[];
  refinements: BoundaryRefinement[];
  triggerDanmaku: Array<{ timeOffset: number; text: string; user?: string }>;
  signalDetails: Evidence["signalDetails"];
}

/**
 * 组装 autoclip 切片决策证据链。
 * 纯函数，不依赖外部状态，可独立测试。
 */
export function buildEvidence(params: BuildEvidenceParams): Evidence {
  const { densityBuckets, highlights, refinements, triggerDanmaku, signalDetails } = params;

  // 弹幕密度曲线（直接映射 DensityBucket -> Evidence 数据点）
  const danmakuDensityCurve = densityBuckets.map((b) => ({
    timeOffset: b.timeOffset,
    count: b.count,
    density: b.density,
  }));

  // LLM 评分（从 highlights 提取）
  const llmScores = highlights.map((h) => ({
    score: h.score,
    highlightType: h.highlightType,
    reason: h.reason ?? "",
    tags: h.tags ?? [],
    isHighlight: h.isHighlight,
  }));

  return {
    danmakuDensityCurve,
    triggerDanmaku,
    signalDetails,
    boundaryRefinements: refinements,
    llmScores,
  };
}
