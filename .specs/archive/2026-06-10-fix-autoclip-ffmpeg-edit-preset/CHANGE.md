# CHANGE: 修复 AutoClip 导出设置中 FFmpeg 编辑预设按钮无响应

- **Change ID**: fix-autoclip-ffmpeg-edit-preset
- **创建日期**: 2026-06-09
- **路径建议**: 最短（纯 bug 修复）
- **状态**: active

---

## Why（为什么做）

用户在 AutoClip 预设编辑弹窗（AutoClipPresetDialog）的"导出设置"tab 中，选中自定义 FFmpeg 预设后，点击「编辑此预设 →」按钮没有任何可见反应。

**根因**：按钮的 `router.push({ path: '/home', query: { tab: 'ffmpeg-setting' } })` 确实执行了路由跳转，但由于该按钮位于**嵌套模态框**内部（AutoClipPresetDialog → CutSetting → AppSettingDialog → MainLayout），路由变化后页面内容被上层模态框遮挡，用户看不到任何变化，表现为"没反应"。

## What（做什么）

修改 `AutoClipPresetDialog.vue` 中「编辑此预设 →」按钮的点击处理：在路由跳转**之前**关闭 AutoClipPresetDialog 弹窗，让用户能看到底层页面的路由变化。

## 影响面

- [ ] 影响 `REQUIREMENT.md`
- [ ] 影响 `DESIGN.md` / 引入新 ADR
- [ ] 影响现有 AC
- [ ] 影响数据模型 / 迁移
- [ ] 影响外部 API 兼容性
- [x] 仅修复 bug，无范围变化

## 范围排除（这次不做）

- 不修改 FFmpeg 预设管理页面本身的任何逻辑
- 不处理 429 限流错误（这是 autoClip API 的独立问题，用户可能在频繁操作时触发）
- 不关闭父级设置弹窗 AppSettingDialog（用户手动关闭即可看到 FFmpeg 设置页）

## 验收线（粗粒度）

- 在 AutoClipPresetDialog 导出设置 tab 选中自定义 FFmpeg 预设后，点击「编辑此预设 →」按钮，弹窗关闭并跳转到 FFmpeg 设置页（`/home?tab=ffmpeg-setting`）

## 风险与未知

- 429 错误（请求过于频繁）是 autoClip 路由的 rate limit 机制产生的，与按钮点击本身无关
