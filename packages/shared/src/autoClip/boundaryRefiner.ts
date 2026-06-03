import type {
  HighlightSegment,
  BoundaryRefineConfig,
  BoundaryAdjustment,
  BoundaryRefineResult,
  BoundaryRefinement,
} from "./types.js";
import { extractAndParseJSON } from "./jsonParser.js";
import { sendWithTimeout } from "./llmUtils.js";
import { MAX_ASR_CHARS_PER_CLIP, MAX_FRAME_CHARS_PER_CLIP } from "./constants.js";
import logger from "../utils/log.js";

/**
 * Refine clip boundaries using ASR + frame data.
 *
 * Each highlight is sent as an independent LLM call with its own timeout,
 * so a single slow clip doesn't block the others.
 */
export async function refineBoundaries(
  highlights: HighlightSegment[],
  asrMap: Map<number, string>,
  frameMap: Map<number, string>,
  sendMessage: (prompt: string, signal?: AbortSignal) => Promise<string>,
  config: BoundaryRefineConfig,
  videoDuration: number,
  signal?: AbortSignal,
): Promise<{ highlights: HighlightSegment[]; refinements: BoundaryRefinement[] }> {
  const emptyResult = { highlights, refinements: [] as BoundaryRefinement[] };
  if (highlights.length === 0) return emptyResult;

  const hasASR = asrMap.size > 0;
  const hasFrames = frameMap.size > 0;
  if (!hasASR && !hasFrames) {
    logger.info("boundaryRefiner: no ASR or frame data, skipping");
    return emptyResult;
  }

  const maxAdjustSec = config.maxAdjustSec ?? 30;
  const minClipDuration = config.minClipDuration ?? 15;
  const contextWindowSec = config.contextWindowSec ?? 60;

  const systemPrompt = buildSystemPrompt(maxAdjustSec, hasASR, hasFrames);

  // Send each highlight independently — smaller prompt, independent timeout
  const allAdjustments: BoundaryAdjustment[] = [];
  let successCount = 0;

  for (let i = 0; i < highlights.length; i++) {
    const h = highlights[i]!;
    checkAborted(signal);

    const userPrompt = buildPerClipPrompt(
      i,
      h,
      asrMap,
      frameMap,
      maxAdjustSec,
      contextWindowSec,
      videoDuration,
    );
    const fullPrompt = `System: ${systemPrompt}\n\nUser: ${userPrompt}`;

    try {
      const response = await sendWithTimeout(sendMessage, fullPrompt, {
        externalSignal: signal,
      });
      const adjustments = parseSingleClipResponse(response, i);
      if (adjustments) {
        allAdjustments.push(...adjustments);
        successCount++;
      }
    } catch (err) {
      logger.warn(`boundaryRefiner: clip ${i} LLM call failed, keeping original boundaries`, err);
      // Continue to next clip — this one keeps original boundaries
    }
  }

  if (allAdjustments.length === 0) {
    logger.info(
      "boundaryRefiner: no valid adjustments from any clip, keeping all original boundaries",
    );
    return emptyResult;
  }

  logger.info(
    `boundaryRefiner: ${successCount}/${highlights.length} clips adjusted (${allAdjustments.length} adjustments)`,
  );

  // Save original boundaries for refinement records
  const originals = highlights.map((h) => ({
    start: h.timeRange[0],
    end: h.timeRange[1],
  }));

  const refined = applyBoundaryAdjustments(
    highlights,
    allAdjustments,
    maxAdjustSec,
    minClipDuration,
    videoDuration,
  );

  // Build refinement records: compare original vs refined boundaries
  const refinements: BoundaryRefinement[] = refined.map((h, i) => {
    const orig = originals[i]!;
    return {
      originalStart: orig.start,
      originalEnd: orig.end,
      refinedStart: h.timeRange[0],
      refinedEnd: h.timeRange[1],
      reason: allAdjustments
        .filter((a) => a.highlightIndex === i)
        .map((a) => [a.startReason, a.endReason].filter(Boolean).join("; "))
        .join(" | "),
    };
  });

  return { highlights: refined, refinements };
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildSystemPrompt(maxAdjustSec: number, hasASR: boolean, hasFrames: boolean): string {
  const asrClause = hasASR ? "- 根据语音转文字（ASR）判断对话是否在完整句子处结束" : "";
  const frameClause = hasFrames ? "- 根据关键帧描述判断是否有场景切换、动作收尾" : "";

  return `你是一个专业的视频剪辑师。你需要根据以下信息判断这个高光片段的起止边界是否合理，并给出调整建议。

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
- confidence 为 "low" 的调整将被系统忽略，仅在边界明显不合理时使用 "high" 或 "medium"`;
}

function buildPerClipPrompt(
  index: number,
  h: HighlightSegment,
  asrMap: Map<number, string>,
  frameMap: Map<number, string>,
  maxAdjustSec: number,
  contextWindowSec: number,
  duration: number,
): string {
  const parts: string[] = [];
  const [start, end] = h.timeRange;
  const clipDuration = end - start;

  parts.push(`视频总时长: ${duration}秒`);
  parts.push(`最大调整幅度: ±${maxAdjustSec}秒`);
  parts.push("");
  parts.push(`═══ 片段 ${index} ═══`);
  parts.push(`主题: ${h.title}`);
  parts.push(`当前区间: ${formatTime(start)} → ${formatTime(end)} (${clipDuration}秒)`);
  parts.push(`评分: ${h.score} | 类型: ${h.highlightType}`);
  parts.push("");

  const asrText = asrMap.get(index);
  if (asrText) {
    parts.push("--- 语音转文字 (ASR) ---");
    const truncated =
      asrText.length > MAX_ASR_CHARS_PER_CLIP
        ? asrText.slice(0, MAX_ASR_CHARS_PER_CLIP) + "..."
        : asrText;
    parts.push(truncated);
    parts.push("");
  }

  const frames = frameMap.get(index);
  if (frames) {
    parts.push("--- 关键帧描述 ---");
    const truncated =
      frames.length > MAX_FRAME_CHARS_PER_CLIP
        ? frames.slice(0, MAX_FRAME_CHARS_PER_CLIP) + "..."
        : frames;
    parts.push(truncated);
    parts.push("");
  }

  parts.push("---");
  parts.push("请评估这个片段并返回 JSON。只返回 JSON，不要其他内容。");

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseSingleClipResponse(raw: string, expectedIndex: number): BoundaryAdjustment[] | null {
  const parsed = extractAndParseJSON<BoundaryRefineResult>(raw);
  if (!parsed || !Array.isArray(parsed.adjustments)) {
    logger.warn(`boundaryRefiner: failed to parse LLM response for clip ${expectedIndex}`, {
      raw: raw.slice(0, 200),
    });
    return null;
  }

  const adjustments = parsed.adjustments.filter(
    (a) =>
      typeof a.highlightIndex === "number" &&
      a.highlightIndex >= 0 &&
      typeof a.startAdjustment === "number" &&
      typeof a.endAdjustment === "number" &&
      !isNaN(a.startAdjustment) &&
      !isNaN(a.endAdjustment),
  );

  // Force highlightIndex to match the clip we sent (safety: LLM may return wrong index)
  for (const adj of adjustments) {
    adj.highlightIndex = expectedIndex;
  }

  if (adjustments.length === 0) {
    logger.warn(`boundaryRefiner: no valid adjustments in response for clip ${expectedIndex}`);
    return null;
  }

  return adjustments;
}

// ---------------------------------------------------------------------------
// Constraint application
// ---------------------------------------------------------------------------

function applyBoundaryAdjustments(
  highlights: HighlightSegment[],
  adjustments: BoundaryAdjustment[],
  maxAdjustSec: number,
  minClipDuration: number,
  videoDuration: number,
): HighlightSegment[] {
  const result = highlights.map((h) => ({ ...h, timeRange: [...h.timeRange] as [number, number] }));

  for (const adj of adjustments) {
    if (adj.confidence === "low") continue;

    const h = result[adj.highlightIndex];
    if (!h) continue;

    let [newStart, newEnd] = h.timeRange;

    // Apply adjustments
    newStart += adj.startAdjustment;
    newEnd += adj.endAdjustment;

    // Constraint 1: clamp to maxAdjustSec
    const origStart = highlights[adj.highlightIndex]!.timeRange[0];
    const origEnd = highlights[adj.highlightIndex]!.timeRange[1];
    newStart = clamp(newStart, origStart - maxAdjustSec, origStart + maxAdjustSec);
    newEnd = clamp(newEnd, origEnd - maxAdjustSec, origEnd + maxAdjustSec);

    // Constraint 2: video bounds
    newStart = Math.max(0, newStart);
    newEnd = Math.min(videoDuration, newEnd);

    // Constraint 3: min clip duration
    if (newEnd - newStart < minClipDuration) {
      logger.info(
        `boundaryRefiner: clip ${adj.highlightIndex} would be too short (${(newEnd - newStart).toFixed(1)}s), keeping original`,
      );
      continue;
    }

    h.timeRange = [newStart, newEnd];
    h.bestRange = [newStart, newEnd];
  }

  // Constraint 4: resolve overlaps
  return resolveOverlaps(result);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function checkAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function resolveOverlaps(highlights: HighlightSegment[]): HighlightSegment[] {
  const working = highlights.map((h) => ({
    ...h,
    timeRange: [...h.timeRange] as [number, number],
  }));
  for (let i = 0; i < working.length - 1; i++) {
    const curr = working[i]!;
    const next = working[i + 1]!;
    const overlap = curr.timeRange[1] - next.timeRange[0];

    if (overlap <= 0) {
      continue;
    }

    if (overlap <= 3) {
      const newEnd = Math.max(curr.timeRange[0], next.timeRange[0] - 1);
      if (newEnd < curr.timeRange[0]) {
        curr.timeRange = [curr.timeRange[0], curr.timeRange[0] + 1];
        curr.bestRange = [curr.timeRange[0], curr.timeRange[0] + 1];
      } else {
        curr.timeRange = [curr.timeRange[0], newEnd];
        curr.bestRange = [curr.timeRange[0], newEnd];
      }
    } else {
      const mergedStart = Math.min(curr.timeRange[0], next.timeRange[0]);
      const mergedEnd = Math.max(curr.timeRange[1], next.timeRange[1]);
      const useCurr = curr.score >= next.score;
      working[i] = {
        ...curr,
        timeRange: [mergedStart, mergedEnd],
        bestRange: [mergedStart, mergedEnd],
        title: `${curr.title} + ${next.title}`,
        score: Math.max(curr.score, next.score),
        tags: [...new Set([...curr.tags, ...next.tags])],
        highlightType: useCurr ? curr.highlightType : next.highlightType,
        reason: useCurr ? curr.reason : next.reason,
        signalSources: [...new Set([...curr.signalSources, ...next.signalSources])],
      };
      working.splice(i + 1, 1);
      let backwardMerged = false;
      if (i > 0) {
        const prev = working[i - 1]!;
        const merged = working[i]!;
        if (prev.timeRange[1] > merged.timeRange[0]) {
          const pMergeEnd = Math.max(prev.timeRange[1], merged.timeRange[1]);
          const pUsePrev = prev.score >= merged.score;
          working[i - 1] = {
            ...prev,
            timeRange: [prev.timeRange[0], pMergeEnd],
            bestRange: [prev.timeRange[0], pMergeEnd],
            title: `${prev.title} + ${merged.title}`,
            score: Math.max(prev.score, merged.score),
            tags: [...new Set([...prev.tags, ...merged.tags])],
            highlightType: pUsePrev ? prev.highlightType : merged.highlightType,
            reason: pUsePrev ? prev.reason : merged.reason,
            signalSources: [...new Set([...prev.signalSources, ...merged.signalSources])],
          };
          working.splice(i, 1);
          backwardMerged = true;
        }
      }
      i -= backwardMerged ? 2 : 1;
    }
  }
  return working;
}
