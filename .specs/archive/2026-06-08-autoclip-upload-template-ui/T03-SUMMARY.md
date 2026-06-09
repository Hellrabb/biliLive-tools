# T03-SUMMARY · AUTO_CLIP_DEFAULT_CONFIG 默认值

> 日期：2026-06-08
> 状态：done

## 做了什么

在 `AUTO_CLIP_DEFAULT_CONFIG.export` 中新增 `biliUpTemplate` 默认值：

- titleTemplate: `"{{highlightTitle}}"`
- descTemplate: `""`
- tag: `["biliLive-tools"]`
- tid: `138`
- copyright: `1`（自制）
- cover: `""`（留空→自动提取）
- noReprint: `0`

## 改动的文件

- `packages/shared/src/presets/autoClipPreset.ts` (+10 行)

## verify 输出

```
npx tsc --noEmit -p tsconfig.json → 无错误
```

## 6 维自查

✅ 沿用既有抽象 grep（R6.4）：仅改常量结构，无新抽象依赖

✅ 破坏性变更（R4.6）：未命中（仅新增默认字段，无删除）

✅ 越界检查（R6.5）：

- TASK write_files：1 项
- 实际 diff：1 项
- 越界：0
