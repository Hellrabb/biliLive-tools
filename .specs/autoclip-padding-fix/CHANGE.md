# CHANGE · autoclip-padding-fix

## Why

`resolveOverlaps` 硬编码 3s 作为重叠合并阈值：边界精修后相邻片段重叠 > 3s 即合并为一个。阈值太松，精修稍微扩展边界就触发级联合并，经常把多个独立高光吞成超长片段。用户即使把 `maxWindowDuration` 设为 300s，最终仍输出几十分钟的切片。

## What

**`resolveOverlaps` 合并阈值改为可配** — `BoundaryRefineConfig` 新增 `overlapMergeThreshold`（默认 60s）。边界精修后相邻片段：

- 重叠 ≤ `overlapMergeThreshold` → 裁剪前一片段末尾，各自独立
- 重叠 > `overlapMergeThreshold` → 合并（视为同一事件）
- 不做硬截断上限

## 影响面

| 层级     | 文件                                                                | 改动                                                               |
| -------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 类型     | `packages/types/src/index.ts`                                       | `BoundaryRefineConfig` 新增 `overlapMergeThreshold?: number`       |
| 边界精修 | `packages/shared/src/autoClip/boundaryRefiner.ts`                   | `resolveOverlaps`：硬编码 3s → `overlapMergeThreshold`（默认 60s） |
| 前端     | `packages/app/src/renderer/src/components/AutoClipPresetDialog.vue` | 新增 overlapMergeThreshold 输入项                                  |

## 范围排除

- 不改 `exportPadding`（不做导出层 padding 剥离）
- 不改 `mergeAndDeduplicate` M2 重合并
- 不调整信号检测默认值
- 不变更 LLM prompt 模板

## 验收线

- `overlapMergeThreshold: 60` 下，边界精修后相邻高光重叠 ≤ 60s 不合并、> 60s 合并
- 不做任何硬截断上限
- 现有 autoClip 测试通过

## 路径建议

最短：`TASK → DEV → TEST → REVIEW → INTEGRATION`

纯阈值参数化，改动范围小（~20 行），可跳 REQUIREMENT 和 DESIGN。
