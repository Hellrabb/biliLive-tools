# CHANGE: 修复 Docker build:webui 类型检查失败

- **Change ID**: fix-docker-build-typecheck
- **创建日期**: 2026-06-10
- **路径建议**: 最短（skip REQUIREMENT + DESIGN）
- **状态**: draft

---

## Why（为什么做）

Docker 构建 `build:webui` 失败（exit code 2）。根因是两个叠加的类型错误：

1. `BoundaryRefineConfig` 缺少 `overlapMergeThreshold` 字段 → shared typecheck 失败
2. `AutoClipPresetDialog.vue` 中 `editingPreset` 缺少 null guard → vue-tsc 失败

错误 1 阻塞了 `build:base`，导致错误 2 之前未被发现（build 在 shared 阶段就中止了）。

## What（做什么）

1. `packages/shared/src/autoClip/types.ts`：补 `BoundaryRefineConfig.overlapMergeThreshold?: number`
2. `packages/app/src/renderer/src/components/AutoClipPresetDialog.vue`：`editingPreset.config` → `editingPreset?.config?.`

## 影响面

- [ ] 影响 `REQUIREMENT.md`
- [ ] 影响 `DESIGN.md` / 引入新 ADR
- [ ] 影响现有 AC
- [ ] 影响数据模型 / 迁移
- [ ] 影响外部 API 兼容性
- [x] 仅修复 bug，无范围变化

## 范围排除（这次不做）

- 不重构 boundaryRefiner 的其他部分
- 不修改 Dockerfile

## 验收线

- `build:base` 通过（test + typecheck + tsc 全绿）
- `build:webui` 通过（typecheck:web + electron-vite build）
- Docker 构建可正常完成

## 风险与未知

- 无
