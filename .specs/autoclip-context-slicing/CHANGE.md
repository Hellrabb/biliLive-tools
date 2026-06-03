# CHANGE — autoclip-context-slicing

> 生成日期：2026-06-04
> 来源：用户反馈 — 边界智能精修缺少独立模型配置

## Why

用户在设置中想为"边界智能精修"指定独立的 LLM 模型，但当前边界精修复用主 LLM 的 `modelId`，无法单独配置。对比 ASR（有 `asrModelId`）和视觉理解（有 `visionModelId`），边界精修缺了独立模型字段。

## What

为边界精修（Phase 1.6）新增独立的 `boundaryRefineModelId` 配置字段：

1. 类型层：`AutoClipLLMConfig` 新增 `boundaryRefineModelId?: string`
2. 消息发送层：`sendMessage.ts` 支持按 modelId 构建独立的 sendMessage
3. 管线层：`pipeline.ts` 接受可选的专用 `sendBoundaryRefineMessage`
4. 服务层：`service.ts` 构建边界精修专用 sendMessage（fallback 到主 sendMessage）
5. UI 层：`AutoClipPresetDialog.vue` 增强 tab 下新增模型 ID 输入框

## 影响面

- `packages/types/src/index.ts` — AutoClipLLMConfig 加字段
- `packages/shared/src/autoClip/sendMessage.ts` — 支持可选 modelId override
- `packages/shared/src/autoClip/pipeline.ts` — PipelineParams 加可选参数
- `packages/shared/src/autoClip/service.ts` — 构建专用 sendMessage
- `packages/app/src/renderer/src/components/AutoClipPresetDialog.vue` — UI 输入框

## 范围排除

- 不改边界精修算法（prompt/约束逻辑）
- 不改 ASR/视觉模型逻辑
- 不改预设迁移（新增字段默认 undefined，fallback 到主模型）
- 不做数据库 schema 变更

## 验收线

1. `boundaryRefineModelId` 填入有效模型 ID 时，边界精修使用该模型
2. `boundaryRefineModelId` 为空时，fallback 到主 `llm.modelId`（保持向后兼容）
3. UI 输入框仅在边界精修开关 ON 时显示
4. `pnpm run build:base` 构建成功
5. `pnpm run test` 全部通过

## 路径建议

小改动，走最短路径：TASK → DEV → TEST → REVIEW
