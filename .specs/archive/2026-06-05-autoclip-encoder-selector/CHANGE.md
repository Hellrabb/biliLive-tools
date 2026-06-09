# CHANGE — AutoClip 编码器/预设下拉选择

## Why

AutoClip 预设编辑对话框（`AutoClipPresetDialog.vue`）的「导出设置」Tab 中，「视频编码器」和「FFmpeg 预设」两个字段目前是**自由文本输入框**（`n-input`），用户必须手动输入精确的编码器名（如 `h264_nvenc`）和预设 ID（如 `b_nvenc_h264`）。

对比：

- 同项目的 `ffmpegSetting.vue` 早已使用 `n-select` 下拉框选择编码器（从 `videoEncoders` 枚举加载）
- 同对话框的「弹幕预设」字段已使用 `n-select` 下拉框从 API 加载选项

**用户不知道有哪些可选值，无法便捷地切换 NVENC/QSV/AMF 等硬件编码器。**

## What

将 `AutoClipPresetDialog.vue` 导出设置 Tab 中的两个字段从文本输入改为下拉选择：

1. **视频编码器**：`n-input` → `n-select`，数据源为 `videoEncoders` 枚举（从 `@biliLive-tools/shared/enum.js` 导入），包含全部编码器选项（libx264 / h264_nvenc / hevc_nvenc / av1_nvenc / h264_qsv / ...）
2. **FFmpeg 预设**：`n-input` → `n-select`，数据源通过 `ffmpegPresetApi.list()` 从后端加载现有 FFmpeg 预设列表

## 影响面

| 文件                                                                | 改动                                                                                         |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/app/src/renderer/src/components/AutoClipPresetDialog.vue` | 核心改动：替换 2 个 `n-input` 为 `n-select`，新增 import 和 options 加载逻辑                 |
| 类型 `AutoClipExportConfig`                                         | **不改动**（`encoder: string` 和 `ffmpegPresetId: string` 的语义不变，只是前端输入方式变了） |
| 后端 API                                                            | **不改动**（`/preset/ffmpeg` list 接口已存在，直接复用）                                     |

## 范围排除

- ❌ 不改动 `ffmpegSetting.vue`（已有正确的下拉选择器）
- ❌ 不改动 `CutSetting.vue` 的 `autoClipPresetId` 选择器（已使用 `n-select` + `presetOptions`）
- ❌ 不改动后端编码器/预设逻辑（`exportPipeline.ts` 的优先级链保持不变）
- ❌ 不新增 API 端点（复用现有 `/preset/ffmpeg` 和 `videoEncoders` 枚举）

## 验收线

- [ ] AutoClip 预设对话框中，「视频编码器」显示为下拉框，列出所有可用编码器
- [ ] AutoClip 预设对话框中，「FFmpeg 预设」显示为下拉框，列出所有已配置的 FFmpeg 预设
- [ ] 选中预设后，编码器字段不受影响（两个字段独立，预设优先级在导出时由后端处理）
- [ ] 保存/加载预设数据正常（`encoder` 和 `ffmpegPresetId` 值正确持久化）
- [ ] 不引入 TypeScript 编译错误
