# AutoClip 边界精修（Boundary Refinement）设计规范

## 问题陈述

当前 autoclip 的切片边界完全由弹幕/SC/礼物等外部信号决定。信号检测只能回答"哪里人气高"，无法判断"动作是否做完、对话是否结束"。结果切片经常出现：

- **动作截断**：主播正在打 BOSS，BOSS 还没倒视频就停了
- **对话截断**：主播说到一半，句子不完整就被切断
- **缺前因**：切片开头直接进入高潮，没有任何铺垫

## 设计概要

在现有 Phase 1.5（内容理解：ASR + 视觉帧描述）之后，增加 Phase 1.6 边界精修步骤。复用 Phase 1.5 已产出的 ASR 文本和帧描述，通过一次批量 LLM 调用调整所有片段的起止时间。

## 管线位置

```
解析弹幕 → 过滤 → 信号检测 → LLM排序 → Phase 1.5(ASR+视觉)
                                                   ↓
                                          [NEW] Phase 1.6: 边界精修
                                                   ↓
                                          Phase 2: 风格化标题
```

## 类型变更

### types 包新增 (`packages/types/src/index.ts`)

```ts
export interface AutoClipEnhancementConfig {
  asrEnabled: boolean;
  visualEnabled: boolean;
  /** 边界精修开关，默认 true */
  boundaryRefineEnabled: boolean;
}
```

### autoClip 模块新增 (`packages/shared/src/autoClip/types.ts`)

```ts
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
  startAdjustment: number;   // 负数=向前扩展，正数=后移起点
  endAdjustment: number;     // 正数=向后扩展，负数=提前终点
  startReason: string;
  endReason: string;
  confidence: "high" | "medium" | "low";
}

export interface BoundaryRefineResult {
  adjustments: BoundaryAdjustment[];
}
```

## 核心函数

### `refineBoundaries()` (新文件 `boundaryRefiner.ts`)

```ts
export async function refineBoundaries(
  highlights: HighlightSegment[],
  asrMap: Map<number, string>,
  frameMap: Map<number, string[]>,
  sendMessage: (prompt: string, signal?: AbortSignal) => Promise<string>,
  config: BoundaryRefineConfig,
): Promise<HighlightSegment[]>
```

**处理流程：**

1. 为每个 highlight 采样边界前后的 ASR + 帧数据
   - 起点窗口: `[start - contextWindowSec, start + 15s]`
   - 终点窗口: `[end - 15s, end + contextWindowSec]`
   - 最近的 1-2 个关键帧描述
2. 构建批量 prompt（所有 n 个片段合并为一次 LLM 调用）
3. 解析 LLM 返回的 JSON → `BoundaryAdjustment[]`
4. 应用调整 + 5 层约束校验
5. 返回调整后的 highlights

**约束校验（按优先级）：**

| 优先级 | 约束 | 违规处理 |
|--------|------|----------|
| 1 | 调整幅度 ≤ `maxAdjustSec` | 裁剪到 `[-max, +max]` |
| 2 | 调整后时长 ≥ `minClipDuration` | 回退到原始边界 |
| 3 | 不超出视频时长 `[0, duration]` | 裁剪到有效范围 |
| 4 | 不与相邻片段重叠 | 压缩当前起点到前片段终点+1s |
| 5 | `confidence === "low"` | 保持原始边界不变 |

**特殊处理：**
- 相邻片段调整后重叠 > 3s → 合并为一个片段（保留更完整的边界）

## LLM Prompt 设计

### System Prompt

```
你是一个专业的视频剪辑师。你需要根据视频的语音转文字（ASR）和关键帧描述，判断高光片段的起止边界是否合理，并给出调整建议。

评估标准：
1. 起点处"前因是否完整"：观众能否理解正在发生什么
2. 终点处"动作/对话是否有收尾"：故事是否告一段落
3. 对话是否在完整句子处结束（非打断）
4. 调整幅度不能超过 ±{maxAdjustSec} 秒

输出格式要求：返回 JSON 数组，每个元素对应一个片段。
```

### User Prompt 结构

```
视频总时长: {duration}秒
最大调整幅度: ±{maxAdjustSec}秒

{每个片段依次列出}

[片段 N]
主题: {highlight.title}
当前区间: {start} → {end} ({duration}秒)

═══ 起点前后语音转文字 ═══
{起点前60s到起点后15s的ASR文本，标注当前起点位置}

═══ 终点前后语音转文字 ═══
{终点前15s到终点后60s的ASR文本，标注当前终点位置}

═══ 关键帧描述 ═══
{时间戳} - {帧描述}

---

请评估每个片段并返回JSON：
{
  "adjustments": [
    {
      "highlightIndex": 0,
      "startAdjustment": -5,
      "endAdjustment": 12,
      "startReason": "起点前主播正在介绍打法背景，向前扩展5秒补全铺垫",
      "endReason": "Boss在终点后12秒才死亡并有主播总结，扩展到完整收尾",
      "confidence": "high"
    }
  ]
}

注意：
- startAdjustment 负数=向前扩展，正数=后移起点
- endAdjustment 正数=向后扩展，负数=提前终点
- confidence 为 "low" 时系统将保持原始边界不变
- 片段之间不能重叠
```

### 边界判断规则（prompt 内嵌）

| 信号 | 判断 | 动作 |
|------|------|------|
| ASR 终点处句子不完整 | 对话截断 | 向后扩展找到句子结束 |
| ASR 起点处缺少铺垫 | 缺前因 | 向前扩展找到话题起点 |
| 终点后 ASR 出现总结性语句 | 自然断点 | 收缩到总结之前 |
| 关键帧显示场景切换 | 视觉断点 | 优先对齐到场景切换点 |
| 终点附近长时间沉默 (>3s) | 自然停顿 | 以此为参考边界 |

## 容错策略

| 场景 | 策略 |
|------|------|
| LLM 调用失败/超时 | 返回原始 highlights，日志 warn，管线继续 |
| JSON 解析失败 | 降级到 jsonParser 修复逻辑，修复失败则跳过全部调整 |
| ASR 完全不可用 (asrMap 为空) | 只用帧描述做精修，所有 confidence 上限 medium |
| ASR + 帧描述都不可用 | 跳过边界精修，直接进入标题生成 |
| adjustments 数组长度与 highlights 不匹配 | 匹配索引应用，多余的忽略，缺少的保持原边界 |
| 单个片段调整后越界 | 裁剪到有效范围，confidence 降为 low |

## 配置 & UI

### EnhanceConfig 面板变动

在 `packages/app/src/renderer/` 的 AutoClip 预设编辑页面中，EnhanceConfig 区域新增一个开关：

- **边界智能精修** `boundaryRefineEnabled` — 默认 ON
- 提示文案："分析视频语音和画面，自动优化切片起止位置，避免剧情不完整"
- 依赖：需要先开启 ASR 或视觉理解（至少一项），否则置灰

## 测试策略

| 测试 | 内容 |
|------|------|
| 单元测试 `boundaryRefiner.test.ts` | `applyBoundaryAdjustments()` 的 5 层约束校验：超幅裁剪、最小时长保护、边界裁剪、重叠压缩、低置信度回退。mock 掉 `sendMessage` |
| 单元测试 `boundaryRefiner.test.ts` | `buildBoundaryRefinePrompt()` 输出格式验证 |
| 单元测试 `boundaryRefiner.test.ts` | `parseRefineResponse()` 正常 JSON、畸形 JSON、空数组、部分字段缺失 |
| 集成测试 | mock LLM 返回调整项 → 验证最终 highlight 的 timeRange 正确变更 |
| 集成测试 | mock LLM 抛异常 → 验证 fallback 到原始边界，管线不中断 |

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/types/src/index.ts` | 修改 | `AutoClipEnhancementConfig` 加 `boundaryRefineEnabled` |
| `packages/shared/src/autoClip/types.ts` | 修改 | 新增 `BoundaryRefineConfig`, `BoundaryAdjustment`, `BoundaryRefineResult` |
| `packages/shared/src/autoClip/boundaryRefiner.ts` | **新增** | 核心实现：`buildPrompt` + `parseResponse` + `applyAdjustments` |
| `packages/shared/src/autoClip/pipeline.ts` | 修改 | Phase 1.5 后插入 `refineBoundaries()` 调用 |
| `packages/shared/src/autoClip/index.ts` | 修改 | 导出新模块 |
| `packages/app/src/renderer/` | 修改 | 预设编辑页新增开关 UI |
| `packages/shared/test/autoClip/boundaryRefiner.test.ts` | **新增** | 单元测试 + 集成测试 |
