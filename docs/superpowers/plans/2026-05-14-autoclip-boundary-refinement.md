# AutoClip 边界精修 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Phase 1.5（内容理解）后增加 Phase 1.6 边界精修步骤，复用 ASR/帧描述通过 LLM 优化切片起止边界

**Architecture:** 新增 `boundaryRefiner.ts` 模块，包含 prompt 构建、LLM 响应解析、调整应用+约束校验三个核心函数。在 `pipeline.ts` 的 `understandContent()` 之后、`generateStyledTitles()` 之前插入调用。类型变更涉及 `types` 包和 `autoClip/types.ts`。

**Tech Stack:** TypeScript, Vitest (测试), Vue 3 + Naive UI (开关组件)

---

### Task 1: 类型定义 — types 包加 `boundaryRefineEnabled`

**Files:**
- Modify: `packages/types/src/index.ts:1252-1254`

- [ ] **Step 1: 修改 `AutoClipEnhancementConfig` 接口**

```diff
 export interface AutoClipEnhancementConfig {
   asrEnabled: boolean;
   visualEnabled: boolean;
+  /** 边界智能精修，默认 true */
+  boundaryRefineEnabled: boolean;
 }
```

- [ ] **Step 2: 运行 types 包编译验证**

```bash
cd packages/types && pnpm run build
```
Expected: PASS，无类型错误

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "feat(autoclip): add boundaryRefineEnabled to AutoClipEnhancementConfig

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: 类型定义 — autoClip 模块内部类型

**Files:**
- Modify: `packages/shared/src/autoClip/types.ts`

- [ ] **Step 1: 在文件末尾追加新类型**

在 `packages/shared/src/autoClip/types.ts` 末尾添加：

```ts
// ---------------------------------------------------------------------------
// Phase 1.6: Boundary refinement
// ---------------------------------------------------------------------------

export interface BoundaryRefineConfig {
  /** 最大调整幅度 (秒)，默认 30 */
  maxAdjustSec: number;
  /** 最小片段时长 (秒)，默认 15 */
  minClipDuration: number;
  /** 边界前后采样窗口 (秒)，默认 60 */
  contextWindowSec: number;
}

export interface BoundaryAdjustment {
  highlightIndex: number;
  /** 负数=向前扩展起点，正数=后移起点，0=不变 */
  startAdjustment: number;
  /** 正数=向后扩展终点，负数=提前终点，0=不变 */
  endAdjustment: number;
  startReason: string;
  endReason: string;
  confidence: "high" | "medium" | "low";
}

export interface BoundaryRefineResult {
  adjustments: BoundaryAdjustment[];
}
```

- [ ] **Step 2: 运行 shared 包编译验证**

```bash
cd packages/shared && pnpm run build
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/autoClip/types.ts
git commit -m "feat(autoclip): add BoundaryRefineConfig, BoundaryAdjustment types

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: 核心实现 — `boundaryRefiner.ts` (prompt 构建)

**Files:**
- Create: `packages/shared/src/autoClip/boundaryRefiner.ts`

- [ ] **Step 1: 创建文件骨架**

```ts
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

  const systemPrompt = buildSystemPrompt(config, hasASR, hasFrames);
  const userPrompt = buildUserPrompt(highlights, asrMap, frameMap, config, videoDuration);

  let response: string;
  try {
    response = await sendMessage(`System: ${systemPrompt}\n\nUser: ${userPrompt}`);
  } catch (err) {
    logger.warn("boundaryRefiner: LLM call failed, keeping original boundaries", err);
    return highlights;
  }

  const adjustments = parseRefineResponse(response, highlights.length);
  if (!adjustments) return highlights;

  return applyBoundaryAdjustments(highlights, adjustments, config, videoDuration);
}
```

- [ ] **Step 2: 实现 `buildSystemPrompt()`**

```ts
function buildSystemPrompt(
  config: BoundaryRefineConfig,
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
4. 调整幅度不能超过 ±${config.maxAdjustSec} 秒
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
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/autoClip/boundaryRefiner.ts
git commit -m "feat(autoclip): add boundaryRefiner skeleton and prompt builders

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: 核心实现 — `boundaryRefiner.ts` (User Prompt + 解析)

**Files:**
- Modify: `packages/shared/src/autoClip/boundaryRefiner.ts`

- [ ] **Step 1: 实现 `buildUserPrompt()`**

在 `buildSystemPrompt` 后面添加：

```ts
function buildUserPrompt(
  highlights: HighlightSegment[],
  asrMap: Map<number, string>,
  frameMap: Map<number, string[]>,
  config: BoundaryRefineConfig,
  duration: number,
): string {
  const parts: string[] = [];
  parts.push(`视频总时长: ${duration}秒`);
  parts.push(`最大调整幅度: ±${config.maxAdjustSec}秒`);
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
```

- [ ] **Step 2: 实现 `parseRefineResponse()`**

```ts
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
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/autoClip/boundaryRefiner.ts
git commit -m "feat(autoclip): add user prompt builder and response parser for boundary refiner

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: 核心实现 — `boundaryRefiner.ts` (约束校验 + 调整应用)

**Files:**
- Modify: `packages/shared/src/autoClip/boundaryRefiner.ts`

- [ ] **Step 1: 实现 `applyBoundaryAdjustments()`**

在文件末尾添加：

```ts
function applyBoundaryAdjustments(
  highlights: HighlightSegment[],
  adjustments: BoundaryAdjustment[],
  config: BoundaryRefineConfig,
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
    newStart = clamp(newStart, origStart - config.maxAdjustSec, origStart + config.maxAdjustSec);
    newEnd = clamp(newEnd, origEnd - config.maxAdjustSec, origEnd + config.maxAdjustSec);

    // Constraint 2: min clip duration
    if (newEnd - newStart < config.minClipDuration) {
      logger.info(`boundaryRefiner: clip ${adj.highlightIndex} would be too short (${(newEnd - newStart).toFixed(1)}s), keeping original`);
      continue;
    }

    // Constraint 3: video bounds
    newStart = Math.max(0, newStart);
    newEnd = Math.min(videoDuration, newEnd);

    h.timeRange = [newStart, newEnd];
  }

  // Constraint 4: resolve overlaps
  return resolveOverlaps(result, config.minClipDuration);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function resolveOverlaps(
  highlights: HighlightSegment[],
  minDuration: number,
): HighlightSegment[] {
  for (let i = 0; i < highlights.length - 1; i++) {
    const curr = highlights[i]!;
    const next = highlights[i + 1]!;
    const overlap = curr.timeRange[1] - next.timeRange[0];

    if (overlap <= 3) {
      // Minor overlap: trim current end
      curr.timeRange = [curr.timeRange[0], next.timeRange[0] - 1];
    } else if (overlap > 3) {
      // Significant overlap: merge clips
      const mergedStart = Math.min(curr.timeRange[0], next.timeRange[0]);
      const mergedEnd = Math.max(curr.timeRange[1], next.timeRange[1]);
      const mergedTitle = `${curr.title} + ${next.title}`;
      highlights[i] = {
        ...curr,
        timeRange: [mergedStart, mergedEnd],
        bestRange: [mergedStart, mergedEnd],
        title: mergedTitle,
        signalSources: [...new Set([...curr.signalSources, ...next.signalSources])],
      };
      highlights.splice(i + 1, 1);
      i--; // re-check this position
    }
  }
  return highlights;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/src/autoClip/boundaryRefiner.ts
git commit -m "feat(autoclip): add boundary adjustment application with constraint checks

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: 管线集成 — `pipeline.ts`

**Files:**
- Modify: `packages/shared/src/autoClip/pipeline.ts`

- [ ] **Step 1: 添加 import**

```diff
 import { v4 as uuidv4 } from "uuid";
 import { parseDanmu } from "../danmu/index.js";
 import { detectSignals } from "./signalDetector.js";
 import { rankCandidates, preRankCandidates } from "./llmRanker.js";
 import { detectSuspicious, applyFilter, llmReviewPatterns } from "./danmakuFilter.js";
 import { understandContent } from "./contentUnderstanding.js";
 import { generateStyledTitles } from "./titleStyler.js";
 import { getVideoDuration } from "./exportPipeline.js";
+import { refineBoundaries } from "./boundaryRefiner.js";
 import logger from "../utils/log.js";
```

- [ ] **Step 2: 在 Phase 1.5 后插入 Phase 1.6 调用**

在 `understandContent` 调用成功后、`generateStyledTitles` 之前（约第 197 行）插入：

```diff
         onProgress?.("understand", 88, "Content understanding complete");
 
+        // Phase 1.6: Boundary refinement
+        if (presetConfig.enhancement.boundaryRefineEnabled) {
+          onProgress?.("refine", 89, "Refining clip boundaries...");
+          try {
+            highlights = await refineBoundaries(
+              highlights,
+              asrMap,
+              frameMap,
+              sendMessage,
+              {
+                maxAdjustSec: 30,
+                minClipDuration: 15,
+                contextWindowSec: 60,
+              },
+              duration,
+            );
+            onProgress?.("refine", 92, "Boundaries refined");
+          } catch (err) {
+            logger.warn("AutoClip: boundary refinement failed, using original boundaries", err);
+          }
+        }
+
         onProgress?.("title", 90, "Generating styled titles...");
```

- [ ] **Step 3: 运行 shared 包编译验证**

```bash
cd packages/shared && pnpm run build
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/autoClip/pipeline.ts
git commit -m "feat(autoclip): integrate boundary refiner into pipeline after Phase 1.5

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: 导出 & 预设默认值

**Files:**
- Modify: `packages/shared/src/autoClip/index.ts`
- Modify: `packages/shared/src/presets/autoClipPreset.ts`

- [ ] **Step 1: 在 index.ts 添加导出**

```diff
 export * from "./types.js";
 export * from "./signalDetector.js";
 export * from "./llmRanker.js";
 export * from "./frameSampler.js";
 export * from "./titleStyler.js";
 export * from "./contentUnderstanding.js";
+export * from "./boundaryRefiner.js";
 export * from "./jsonParser.js";
 export * from "./pipeline.js";
 export * from "./exportPipeline.js";
 export * from "./sendMessage.js";
 export * from "./service.js";
```

- [ ] **Step 2: 在 autoClipPreset.ts 添加默认值**

```diff
   enhancement: {
     asrEnabled: false,
     visualEnabled: false,
+    boundaryRefineEnabled: true,
   },
```

- [ ] **Step 3: 运行编译验证**

```bash
cd packages/shared && pnpm run build
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/autoClip/index.ts packages/shared/src/presets/autoClipPreset.ts
git commit -m "feat(autoclip): export boundaryRefiner and add default preset config

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: UI — 增强面板新增边界精修开关

**Files:**
- Modify: `packages/app/src/renderer/src/components/AutoClipPresetDialog.vue`

- [ ] **Step 1: 在增强 Tab 中添加开关**

在"启用视觉理解"开关之后、"视觉模型 ID"之前（Tab 5 区域内）添加：

```vue
                  <n-form-item label="启用边界智能精修">
                    <n-switch v-model:value="editingPreset.config.enhancement.boundaryRefineEnabled" />
                    <template #feedback>
                      <span style="font-size:12px;color:#999">分析语音和画面，自动优化切片起止位置，避免剧情不完整</span>
                    </template>
                  </n-form-item>
```

插入位置在 `</n-form>` 之前，`visualEnabled` 的 `n-form-item` 之后。

- [ ] **Step 2: 运行 app 编译验证**

```bash
cd packages/app && pnpm run build
```
Expected: PASS（或至少类型检查通过）

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/renderer/src/components/AutoClipPresetDialog.vue
git commit -m "feat(autoclip): add boundary refine toggle to enhancement panel

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: 单元测试 — `boundaryRefiner.test.ts`

**Files:**
- Create: `packages/shared/test/autoClip/boundaryRefiner.test.ts`

- [ ] **Step 1: 创建测试文件骨架 + 导入**

```ts
import { describe, it, expect, vi } from "vitest";

// We'll test the internal helper functions by extracting them.
// The main refineBoundaries function is tested via integration.

// For unit tests, we create minimal test fixtures
function makeHighlight(overrides: Partial<{
  start: number; end: number; title: string; score: number;
}> = {}): import("../../src/autoClip/types.js").HighlightSegment {
  const start = overrides.start ?? 100;
  const end = overrides.end ?? 200;
  return {
    timeRange: [start, end],
    bestRange: [start, end],
    score: overrides.score ?? 7,
    title: overrides.title ?? "Test Highlight",
    tags: [],
    highlightType: "hype",
    reason: "test",
    signalSources: ["danmakuDensity"],
    isHighlight: true,
  };
}
```

- [ ] **Step 2: Constraint tests — maxAdjustSec clamping**

```ts
describe("applyBoundaryAdjustments constraint checks", () => {
  // These tests call refineBoundaries with a mock sendMessage
  // to exercise the full constraint pipeline.

  it("should clamp adjustments to maxAdjustSec", async () => {
    const { refineBoundaries } = await import("../../src/autoClip/boundaryRefiner.js");

    const highlights = [makeHighlight({ start: 100, end: 200 })];
    const asrMap = new Map([[0, "some asr text"]]);
    const frameMap = new Map<number, string[]>();

    const mockSend = vi.fn().mockResolvedValue(JSON.stringify({
      adjustments: [{
        highlightIndex: 0,
        startAdjustment: -999,  // way beyond max
        endAdjustment: 999,
        startReason: "extend way back",
        endReason: "extend way forward",
        confidence: "high",
      }],
    }));

    const result = await refineBoundaries(
      highlights, asrMap, frameMap, mockSend,
      { maxAdjustSec: 30, minClipDuration: 15, contextWindowSec: 60 },
      1000,
    );

    expect(result[0]!.timeRange[0]).toBe(70);   // 100 - 30
    expect(result[0]!.timeRange[1]).toBe(230);   // 200 + 30
  });
```

- [ ] **Step 3: Constraint tests — minClipDuration**

```ts
  it("should preserve original boundaries when adjusted clip is too short", async () => {
    const { refineBoundaries } = await import("../../src/autoClip/boundaryRefiner.js");

    const highlights = [makeHighlight({ start: 100, end: 120 })]; // 20s clip
    const asrMap = new Map([[0, "test asr"]]);
    const frameMap = new Map<number, string[]>();

    const mockSend = vi.fn().mockResolvedValue(JSON.stringify({
      adjustments: [{
        highlightIndex: 0,
        startAdjustment: 10,   // would make it 110-110 = 0s
        endAdjustment: -10,
        startReason: "trim",
        endReason: "trim",
        confidence: "high",
      }],
    }));

    const result = await refineBoundaries(
      highlights, asrMap, frameMap, mockSend,
      { maxAdjustSec: 30, minClipDuration: 15, contextWindowSec: 60 },
      1000,
    );

    // Should reject: adjusted duration 0s < min 15s
    expect(result[0]!.timeRange).toEqual([100, 120]);
  });
```

- [ ] **Step 4: Constraint tests — video bounds + low confidence**

```ts
  it("should clamp to video bounds [0, duration]", async () => {
    const { refineBoundaries } = await import("../../src/autoClip/boundaryRefiner.js");

    const highlights = [makeHighlight({ start: 5, end: 50 })];
    const asrMap = new Map([[0, "test"]]);
    const frameMap = new Map<number, string[]>();

    const mockSend = vi.fn().mockResolvedValue(JSON.stringify({
      adjustments: [{
        highlightIndex: 0,
        startAdjustment: -20,  // would go to -15
        endAdjustment: 0,
        startReason: "extend",
        endReason: "",
        confidence: "high",
      }],
    }));

    const result = await refineBoundaries(
      highlights, asrMap, frameMap, mockSend,
      { maxAdjustSec: 30, minClipDuration: 15, contextWindowSec: 60 },
      1000,
    );

    expect(result[0]!.timeRange[0]).toBe(0);
  });

  it("should skip adjustments with confidence=low", async () => {
    const { refineBoundaries } = await import("../../src/autoClip/boundaryRefiner.js");

    const highlights = [makeHighlight({ start: 100, end: 200 })];
    const asrMap = new Map([[0, "test"]]);
    const frameMap = new Map<number, string[]>();

    const mockSend = vi.fn().mockResolvedValue(JSON.stringify({
      adjustments: [{
        highlightIndex: 0,
        startAdjustment: -15,
        endAdjustment: 15,
        startReason: "maybe",
        endReason: "maybe",
        confidence: "low",
      }],
    }));

    const result = await refineBoundaries(
      highlights, asrMap, frameMap, mockSend,
      { maxAdjustSec: 30, minClipDuration: 15, contextWindowSec: 60 },
      1000,
    );

    expect(result[0]!.timeRange).toEqual([100, 200]);
  });
```

- [ ] **Step 5: Overlap resolution tests**

```ts
  it("should trim minor overlap (< 3s) between adjacent clips", async () => {
    const { refineBoundaries } = await import("../../src/autoClip/boundaryRefiner.js");

    const highlights = [
      makeHighlight({ start: 100, end: 200 }),
      makeHighlight({ start: 250, end: 350 }),
    ];
    const asrMap = new Map([[0, "a"], [1, "b"]]);
    const frameMap = new Map<number, string[]>();

    // Adjust clip 0 end to 253, creating 3s overlap with clip 1
    const mockSend = vi.fn().mockResolvedValue(JSON.stringify({
      adjustments: [{
        highlightIndex: 0,
        startAdjustment: 0,
        endAdjustment: 53,
        startReason: "",
        endReason: "extend",
        confidence: "high",
      }],
    }));

    const result = await refineBoundaries(
      highlights, asrMap, frameMap, mockSend,
      { maxAdjustSec: 30, minClipDuration: 15, contextWindowSec: 60 },
      1000,
    );

    // Clip 0 end should be trimmed to clip 1 start - 1
    expect(result[0]!.timeRange[1]).toBe(249);
    expect(result[1]!.timeRange[0]).toBe(250);
  });
```

- [ ] **Step 6: Error handling tests**

```ts
  it("should return original highlights when LLM call throws", async () => {
    const { refineBoundaries } = await import("../../src/autoClip/boundaryRefiner.js");

    const highlights = [makeHighlight({ start: 50, end: 150 })];
    const asrMap = new Map([[0, "test"]]);
    const frameMap = new Map<number, string[]>();

    const mockSend = vi.fn().mockRejectedValue(new Error("network error"));

    const result = await refineBoundaries(
      highlights, asrMap, frameMap, mockSend,
      { maxAdjustSec: 30, minClipDuration: 15, contextWindowSec: 60 },
      1000,
    );

    expect(result).toEqual(highlights);
  });

  it("should return original highlights when JSON parse fails", async () => {
    const { refineBoundaries } = await import("../../src/autoClip/boundaryRefiner.js");

    const highlights = [makeHighlight({ start: 50, end: 150 })];
    const asrMap = new Map([[0, "test"]]);
    const frameMap = new Map<number, string[]>();

    const mockSend = vi.fn().mockResolvedValue("not valid json at all!!!");

    const result = await refineBoundaries(
      highlights, asrMap, frameMap, mockSend,
      { maxAdjustSec: 30, minClipDuration: 15, contextWindowSec: 60 },
      1000,
    );

    expect(result).toEqual(highlights);
  });

  it("should skip when both ASR and frame data are empty", async () => {
    const { refineBoundaries } = await import("../../src/autoClip/boundaryRefiner.js");

    const highlights = [makeHighlight({ start: 50, end: 150 })];
    const mockSend = vi.fn();

    const result = await refineBoundaries(
      highlights,
      new Map(),
      new Map(),
      mockSend,
      { maxAdjustSec: 30, minClipDuration: 15, contextWindowSec: 60 },
      1000,
    );

    expect(mockSend).not.toHaveBeenCalled();
    expect(result).toEqual(highlights);
  });
});
```

- [ ] **Step 7: 运行测试验证**

```bash
cd packages/shared && pnpm run test -- --run test/autoClip/boundaryRefiner.test.ts
```
Expected: 7 tests PASS

- [ ] **Step 8: Commit**

```bash
git add packages/shared/test/autoClip/boundaryRefiner.test.ts
git commit -m "test(autoclip): add boundary refiner unit tests

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 10: 全量验证 & 最终检查

- [ ] **Step 1: 运行全部 autoclip 测试**

```bash
cd packages/shared && pnpm run test -- --run test/autoClip/
```
Expected: 所有已有测试 + 新增 7 个测试 全部 PASS

- [ ] **Step 2: 完整构建检查**

```bash
pnpm run build:base
```
Expected: PASS

- [ ] **Step 3: Commit (如有 CI 配置文件变更)**

```bash
git status
```

---

## 文件变更汇总

| 文件 | 操作 | 内容 |
|------|------|------|
| `packages/types/src/index.ts` | 改 | `AutoClipEnhancementConfig` 加 `boundaryRefineEnabled` |
| `packages/shared/src/autoClip/types.ts` | 改 | 新增 3 个边界精修类型 |
| `packages/shared/src/autoClip/boundaryRefiner.ts` | **新** | 核心实现：prompt 构建 + 解析 + 约束校验 |
| `packages/shared/src/autoClip/index.ts` | 改 | 导出 `boundaryRefiner` |
| `packages/shared/src/autoClip/pipeline.ts` | 改 | 插入 Phase 1.6 调用 |
| `packages/shared/src/presets/autoClipPreset.ts` | 改 | 默认值 `boundaryRefineEnabled: true` |
| `packages/app/src/renderer/src/components/AutoClipPresetDialog.vue` | 改 | 增强面板新增开关 |
| `packages/shared/test/autoClip/boundaryRefiner.test.ts` | **新** | 7 个单元测试 |
