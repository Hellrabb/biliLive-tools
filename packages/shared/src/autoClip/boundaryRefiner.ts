import type { HighlightSegment, BoundaryRefineConfig, BoundaryAdjustment, BoundaryRefineResult } from "./types.js";
import { extractAndParseJSON } from "./jsonParser.js";
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
  const userPrompt = buildUserPrompt(highlights, asrMap, frameMap, maxAdjustSec, contextWindowSec, videoDuration);

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

function buildUserPrompt(
  highlights: HighlightSegment[],
  asrMap: Map<number, string>,
  frameMap: Map<number, string[]>,
  maxAdjustSec: number,
  contextWindowSec: number,
  duration: number,
): string {
  const parts: string[] = [];
  parts.push(`视频总时长: ${duration}秒`);
  parts.push(`最大调整幅度: ±${maxAdjustSec}秒`);
  parts.push(`周边参考数据范围: ±${contextWindowSec}秒`);
  parts.push("");

  for (let i = 0; i < highlights.length; i++) {
    const h = highlights[i]!;
    const [start, end] = h.timeRange;
    const clipDuration = end - start;

    parts.push(`═══ 片段 ${i} ═══`);
    parts.push(`主题: ${h.title}`);
    parts.push(`当前区间: ${formatTime(start)} → ${formatTime(end)} (${clipDuration}秒)`);
    parts.push(`评分: ${h.score} | 类型: ${h.highlightType}`);
    parts.push("");

    const asrText = asrMap.get(i);
    if (asrText) {
      parts.push("--- 语音转文字 (ASR) ---");
      parts.push(asrText);
      parts.push("");
    }

    const frames = frameMap.get(i);
    if (frames && frames.length > 0) {
      parts.push("--- 关键帧描述 ---");
      parts.push(frames.join("\n"));
      parts.push("");
    }
  }

  parts.push("---");
  parts.push("请评估每个片段并返回 JSON。只返回 JSON，不要其他内容。");

  return parts.join("\n");
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function parseRefineResponse(
  raw: string,
  expectedCount: number,
): BoundaryAdjustment[] | null {
  const parsed = extractAndParseJSON<BoundaryRefineResult>(raw);
  if (!parsed || !Array.isArray(parsed.adjustments)) {
    logger.warn("boundaryRefiner: failed to parse LLM response", { raw: raw.slice(0, 200) });
    return null;
  }

  const adjustments = parsed.adjustments.filter(
    (a) =>
      typeof a.highlightIndex === "number" &&
      a.highlightIndex >= 0 &&
      a.highlightIndex < expectedCount,
  );

  if (adjustments.length === 0) {
    logger.warn("boundaryRefiner: no valid adjustments in response");
    return null;
  }

  return adjustments;
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
