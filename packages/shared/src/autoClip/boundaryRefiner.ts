import type { HighlightSegment, BoundaryRefineConfig, BoundaryAdjustment } from "./types.js";
import logger from "../utils/log.js";

export async function refineBoundaries(
  highlights: HighlightSegment[],
  asrMap: Map<number, string>,
  frameMap: Map<number, string[]>,
  sendMessage: (prompt: string, signal?: AbortSignal) => Promise<string>,
  config: BoundaryRefineConfig,
  videoDuration: number,
): Promise<HighlightSegment[]> {
  if (highlights.length === 0) return highlights;

  const hasASR = asrMap.size > 0;
  const hasFrames = frameMap.size > 0;
  if (!hasASR && !hasFrames) {
    logger.info("boundaryRefiner: no ASR or frame data, skipping");
    return highlights;
  }

  const maxAdjustSec = config.maxAdjustSec ?? 30;
  const minClipDuration = config.minClipDuration ?? 15;
  const contextWindowSec = config.contextWindowSec ?? 60;

  const systemPrompt = buildSystemPrompt(maxAdjustSec, hasASR, hasFrames);
  const userPrompt = buildUserPrompt(highlights, asrMap, frameMap, contextWindowSec, videoDuration);

  let response: string;
  try {
    response = await sendMessage(`System: ${systemPrompt}\n\nUser: ${userPrompt}`);
  } catch (err) {
    logger.warn("boundaryRefiner: LLM call failed, keeping original boundaries", err);
    return highlights;
  }

  const adjustments = parseRefineResponse(response, highlights.length);
  if (!adjustments) return highlights;

  return applyBoundaryAdjustments(highlights, adjustments, maxAdjustSec, minClipDuration, videoDuration);
}

function buildSystemPrompt(
  maxAdjustSec: number,
  hasASR: boolean,
  hasFrames: boolean,
): string {
  const asrClause = hasASR
    ? "- 根据语音转文字（ASR）判断对话是否在完整句子处结束"
    : "";
  const frameClause = hasFrames
    ? "- 根据关键帧描述判断是否有场景切换、动作收尾"
    : "";

  return `你是一个专业的视频剪辑师。你需要根据以下信息判断高光片段的起止边界是否合理，并给出调整建议。

评估标准：
1. 起点处"前因是否完整"：观众能否理解正在发生什么
2. 终点处"动作/对话是否有收尾"：故事是否告一段落
3. 对话是否在完整句子处结束（非打断）
4. 调整幅度不能超过 ±${maxAdjustSec} 秒
${asrClause}
${frameClause}

返回格式要求：只返回 JSON，格式为：
{ "adjustments": [{ "highlightIndex": 0, "startAdjustment": -5, "endAdjustment": 0, "startReason": "...", "endReason": "...", "confidence": "high" }] }

注意：
- startAdjustment: 负数=向前扩展起点，正数=后移起点，0=不变
- endAdjustment: 正数=向后扩展终点，负数=提前终点，0=不变
- confidence: "high"=边界明显不合理，"medium"=可能不合理，"low"=基本合理无需调整
- confidence 为 "low" 的调整将被系统忽略，仅在边界明显不合理时使用 "high" 或 "medium"
- 片段之间不能重叠，如有相邻片段请检查调整后是否交叉`;
}

// TODO: Task 4 will implement
function buildUserPrompt(
  _highlights: HighlightSegment[],
  _asrMap: Map<number, string>,
  _frameMap: Map<number, string[]>,
  _contextWindowSec: number,
  _duration: number,
): string {
  return "(TODO: Task 4 - user prompt not yet implemented)";
}

// TODO: Task 4 will implement
function parseRefineResponse(
  _raw: string,
  _expectedCount: number,
): BoundaryAdjustment[] | null {
  return null;
}

// TODO: Task 5 will implement
function applyBoundaryAdjustments(
  highlights: HighlightSegment[],
  _adjustments: BoundaryAdjustment[],
  _maxAdjustSec: number,
  _minClipDuration: number,
  _videoDuration: number,
): HighlightSegment[] {
  return highlights;
}
