# CHANGE: 补齐 AutoClip B站上传模板字段 + 文档

- **Change ID**: autoclip-bili-upload-params
- **创建日期**: 2026-06-10
- **路径建议**: 中等
- **状态**: draft

---

## Why（为什么做）

AutoClip 的 `BiliUpTemplateConfig`（精简版 B站上传模板）目前只有 8 个字段，而主上传系统 `BiliupConfig` 有 ~30 个字段。底层 `uploadToBili()` 已经 spread 了 `DEFAULT_BILIUP_CONFIG` 补齐默认值，但用户在 autoclip 预设中无法覆盖其中 20+ 个字段（如杜比音效、Hi-Res、关闭弹幕/评论、定时发布、空间动态等）。此外，现有字段缺少 JSDoc 注释和前端 tooltip 说明，用户不知道每个字段的含义和约束。

## What（做什么）

1. **扩展 `BiliUpTemplateConfig`**：将所有 `BiliupConfig` 字段纳入（全部 optional），与主上传系统字段对齐
2. **补充 JSDoc 文档**：给 `BiliUpTemplateConfig` 每个字段加 JSDoc 注释（约束、默认值、格式说明）
3. **前端 UI 提示**：AutoClipPresetDialog 导出设置 tab 中，B站上传相关字段加上 tooltip/说明文字
4. **透传新字段**：`service.ts` 的 `uploadToBili()` 将新增字段透传到 `biliApi.addMedia()`

## 影响面

- [x] 影响 `REQUIREMENT.md`
- [ ] 影响 `DESIGN.md` / 引入新 ADR（纯字段扩展，无架构变更）
- [ ] 影响现有 AC
- [ ] 影响数据模型 / 迁移（新增字段全部 optional，向后兼容）
- [ ] 影响外部 API 兼容性（完全向后兼容）
- [ ] 仅修复 bug，无范围变化

## 范围排除（这次不做）

- 不支持"引用已有 videoPreset"——biliUpTemplate 保持内联配置模式
- 不修改 `biliApi.addMedia()` 或底层上传逻辑
- 不修改 videoPreset 系统本身的字段定义
- 不新增 AutoClipPresetDialog 的上传设置子面板（仅在现有面板上补 tooltip）

## 验收线（粗粒度，不是 AC）

- 用户在 autoclip 预设的 `biliUpTemplate` 中可配置任意 B站上传参数（与主上传系统对齐）
- `BiliUpTemplateConfig` 每个字段有 JSDoc 注释，说明用途、约束和默认值
- 前端 AutoClipPresetDialog 导出设置中 B站上传字段有可读的 tooltip/说明

## 风险与未知

- `BiliupConfig` 中部分字段（如 `seasonId`/`sectionId`/`mission_id`/`sortByCid`）在 autoclip 自动上传场景下可能用不到，但纳入不会造成问题（optional，用户不填即走默认值）
- 前端 AutoClipPresetDialog 当前上传设置 UI 较紧凑，新增 ~20 个字段可能需要调整布局或分组——具体在 2-design/4-dev 阶段处理

---

> 后续 AC 与设计细节进入 `REQUIREMENT.md` / `DESIGN.md`，本文件不再扩展。
