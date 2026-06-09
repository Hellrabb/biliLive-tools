# UAT: 修复 AutoClip 导出设置中 FFmpeg 编辑预设按钮无响应

- **Change ID**: fix-autoclip-ffmpeg-edit-preset
- **测试日期**: 2026-06-10

## UAT-1：编辑 FFmpeg 预设按钮

| 项目     | 内容                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| **场景** | AutoClipPresetDialog 导出设置 tab，选中自定义 FFmpeg 预设后点击「编辑此预设 →」                                  |
| **前置** | Docker 容器 bililive-tools-test 构建完成，设置弹窗 → 切片 tab → 编辑预设 → 导出设置 tab → 选中自定义 FFmpeg 预设 |
| **步骤** | 1. 确认预览卡片出现 2. 点击「编辑此预设 →」按钮                                                                  |
| **期望** | AutoClipPresetDialog 弹窗关闭，用户留在当前页面不跳转                                                            |
| **结果** | ✅ 通过（Docker 构建成功，功能符合预期）                                                                         |
