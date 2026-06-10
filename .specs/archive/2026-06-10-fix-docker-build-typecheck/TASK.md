# TASK — fix-docker-build-typecheck

> 拆自 CHANGE.md（最短路径）
> 状态：✅ 全部完成 (2026-06-10)
>
> - [x] T01 — 补 BoundaryRefineConfig.overlapMergeThreshold ✅
> - [x] T02 — 补 editingPreset null guard ✅

## 波次

```
Wave 1 [P]: T01 (shared types), T02 (app vue)
```

---

<task id="T01" parallel="true">
  <name>补 BoundaryRefineConfig.overlapMergeThreshold 字段</name>
  <read_files>packages/shared/src/autoClip/types.ts</read_files>
  <write_files>packages/shared/src/autoClip/types.ts</write_files>
  <action>BoundaryRefineConfig 接口添加 overlapMergeThreshold?: number 字段，与 AutoClipEnhancementConfig.boundaryRefine 内联类型对齐</action>
  <verify>cd packages/shared && pnpm run typecheck</verify>
  <done>shared typecheck 零错误</done>
</task>

<task id="T02" parallel="true">
  <name>补 editingPreset null guard</name>
  <read_files>packages/app/src/renderer/src/components/AutoClipPresetDialog.vue</read_files>
  <write_files>packages/app/src/renderer/src/components/AutoClipPresetDialog.vue</write_files>
  <action>overlapMergeThreshold 的 n-input-number 中 editingPreset.config → editingPreset?.config?.，handler 中加 early return</action>
  <verify>cd packages/app && pnpm run typecheck:web</verify>
  <done>vue-tsc 零错误</done>
</task>
