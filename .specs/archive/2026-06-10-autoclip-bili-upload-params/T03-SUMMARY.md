# T03-SUMMARY — 前端 AutoClipPresetDialog 补充字段 tooltip

- **Change**: autoclip-bili-upload-params
- **Task**: T03
- **日期**: 2026-06-10

## 做了什么

在 AutoClipPresetDialog.vue 的 B站上传设置区域：

1. **补全现有字段 tooltip**：投稿分区、自制/转载、禁止转载、转载来源、简介模板各添加 `#feedback` 说明文字
2. **新增「B站上传高级设置」折叠面板**（n-collapse），收纳 11 个新增字段：
   - 音画质：杜比音效、Hi-Res
   - 交互：关闭弹幕、关闭评论、精选评论
   - 发布：空间动态、定时发布（n-date-picker）、水印、充电面板
   - 评论：自动评论、评论内容（联动显示）
   - 免打扰
3. **添加 `editingBiliDtime` computed**：处理 `biliUpTemplate.dtime`（秒级时间戳）↔ n-date-picker（毫秒）的双向转换

### 改动文件

- `packages/app/src/renderer/src/components/AutoClipPresetDialog.vue`（+170 −1）

## verify 输出

- ✅ `vue-tsc --noEmit`：AutoClipPresetDialog.vue 无类型错误
- ✅ shared 测试全部通过（516 passed, 5 skipped）
- ⚠️ `build:app` 受阻于 shared 预存 typecheck 错误（boundaryRefiner.ts overlapMergeThreshold），非本次修改引入

## 6 维自查（R6.4）

- ✅ 沿用既有抽象：使用 Naive UI 既有组件（n-collapse/n-date-picker/n-switch/n-input），复用 `#feedback` 插槽模式
- ✅ R2 变更传播：仅修改 AutoClipPresetDialog.vue，在 write_files 范围内
- ✅ R1 认知过载：高级字段用折叠面板收纳，不干扰高频操作
- ✅ R6 领域扭曲：字段名与 BiliUpTemplateConfig 完全一致

## 破坏性变更（R4.6）

- 未命中 → 跳过。仅新增 UI 控件，不影响已有功能。

## 越界检查（R6.5）

- ✅ TASK write_files：`packages/app/src/renderer/src/components/AutoClipPresetDialog.vue`
- ✅ 实际 diff：同上 1 文件
- ✅ 越界：0
