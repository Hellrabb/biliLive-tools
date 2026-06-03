# TASK — autoclip-context-slicing

> 生成日期：2026-06-04

## 任务清单

### T1: Types + sendMessage 层 — 新增 `boundaryRefineModelId`

- **read_files**: `packages/types/src/index.ts`, `packages/shared/src/autoClip/sendMessage.ts`
- **write_files**: `packages/types/src/index.ts`, `packages/shared/src/autoClip/sendMessage.ts`
- **action**:
  1. `AutoClipLLMConfig` 新增 `boundaryRefineModelId?: string`（放在 `asrModelId` 旁边）
  2. `buildSendMessage` 签名改为接受可选 `overrideModelId?: string`，传入时用该 modelId 替代 `llmCfg.modelId` 查找模型
- **verify**: `pnpm run build:base` 编译通过
- **done**: types 包编译无报错

### T2: Pipeline + Service 层 — 构建并传递专用 sendMessage

- **read_files**: `packages/shared/src/autoClip/pipeline.ts`, `packages/shared/src/autoClip/service.ts`
- **write_files**: `packages/shared/src/autoClip/pipeline.ts`, `packages/shared/src/autoClip/service.ts`
- **action**:
  1. `PipelineParams` 新增 `sendBoundaryRefineMessage?:` 参数（类型同 `sendMessage`）
  2. `refineBoundaries()` 调用处优先使用 `sendBoundaryRefineMessage`，fallback 到 `sendMessage`
  3. `service.ts` 中：若 `presetConfig.llm.boundaryRefineModelId` 有值，调用 `buildSendMessage` 传入该 modelId 构建专用 sender；否则 undefined（由 pipeline 内部 fallback）
  4. 将专用 sender 传入 `runAutoClipPipeline` 的 `sendBoundaryRefineMessage`
- **verify**: `pnpm run build:base` 编译通过
- **done**: shared 包编译无报错

### T3: UI 层 — AutoClipPresetDialog 新增模型输入框

- **read_files**: `packages/app/src/renderer/src/components/AutoClipPresetDialog.vue`
- **write_files**: `packages/app/src/renderer/src/components/AutoClipPresetDialog.vue`
- **action**:
  1. 在增强 tab 中，边界精修开关 (`n-switch`) 之后，新增 `n-form-item` + `n-input`
  2. 绑定 `v-model:value="editingPreset.config.llm.boundaryRefineModelId"`
  3. 仅当 `boundaryRefineEnabled` 为 true 时显示（`v-if`）
  4. placeholder: "留空使用 LLM 模型"
  5. label: "边界精修模型 ID"
- **verify**: `pnpm run build:app` 编译通过
- **done**: app 包编译无报错
