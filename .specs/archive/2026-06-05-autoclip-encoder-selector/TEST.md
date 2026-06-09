# TEST — autoclip-encoder-selector

## 验证策略

此 change 为纯 UI 控件替换（`n-input` → `n-select`），不涉及业务逻辑变更。项目无 Vue 组件单元测试框架，采用静态验证。

## 验证项

| #   | 验证项          | 方法                                                    | 结果                                       |
| --- | --------------- | ------------------------------------------------------- | ------------------------------------------ |
| 1   | TypeScript 编译 | `tsc --noEmit`                                          | ✅ 0 errors                                |
| 2   | import 路径正确 | `grep` 检查 `videoEncoders` / `ffmpegPresetApi` 来源    | ✅                                         |
| 3   | 模板数据绑定    | `grep` 检查 `n-select :options` 绑定                    | ✅ `videoEncoders` + `ffmpegPresetOptions` |
| 4   | API 数据加载    | `loadFfmpegPresets()` 在 `watch(visible)` 中调用        | ✅                                         |
| 5   | 编码器枚举格式  | `videoEncoders` 输出 `{label, value}[]` 匹配 `n-select` | ✅                                         |
| 6   | 无新增 TS 错误  | `tsc --noEmit` shared + app                             | ✅                                         |

## 手动验证清单（需用户在有 GUI 环境下执行）

- [ ] 打开设置 → AutoClip 预设编辑 → 导出设置 Tab
- [ ] "视频编码器" 显示为下拉框，列出 libx264 / h264_nvenc / hevc_nvenc 等
- [ ] "FFmpeg 预设" 显示为下拉框，列出已配置的预设
- [ ] 选择预设后保存，重新打开确认值持久化
