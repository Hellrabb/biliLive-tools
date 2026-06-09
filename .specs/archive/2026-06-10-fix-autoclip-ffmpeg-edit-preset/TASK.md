# TASK: 修复 AutoClip 导出设置中 FFmpeg 编辑预设按钮无响应

- **Change ID**: fix-autoclip-ffmpeg-edit-preset
- **创建日期**: 2026-06-09

## T01 · 修复编辑按钮点击无响应

- **文件**: `packages/app/src/renderer/src/components/AutoClipPresetDialog.vue`
- **描述**: 「编辑此预设 →」按钮点击后路由跳转被模态框遮挡，用户看不到任何反应。关闭弹窗后再跳转。
- **修改**:
  1. 模板 L298: `@click="router.push(...)"` → `@click="editFfmpegPreset"`
  2. 脚本 L739-742: 新增 `editFfmpegPreset()` 函数，先 `visible.value = false` 关闭弹窗，再 `router.push`
- **验证**: `npx tsc --noEmit` 通过
- **状态**: ✅ done
