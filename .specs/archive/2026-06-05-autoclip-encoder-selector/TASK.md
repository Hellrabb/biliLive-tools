# TASK — autoclip-encoder-selector

## T1: 替换 AutoClip 导出设置中的编码器和 FFmpeg 预设为下拉选择

| 字段             | 当前控件  | 改为       | 数据源                                                |
| ---------------- | --------- | ---------- | ----------------------------------------------------- |
| `encoder`        | `n-input` | `n-select` | `videoEncoders` from `@biliLive-tools/shared/enum.js` |
| `ffmpegPresetId` | `n-input` | `n-select` | `ffmpegPresetApi.list()`                              |

### read_files

- `packages/app/src/renderer/src/components/AutoClipPresetDialog.vue`（唯一改动文件）

### write_files

- `packages/app/src/renderer/src/components/AutoClipPresetDialog.vue`（修改）

### action

1. 在 `<script setup>` 中新增 import：
   - `import { videoEncoders } from "@biliLive-tools/shared/enum.js"`
   - `import { ffmpegPresetApi } from "@renderer/apis/presets"`
2. 新增 `ffmpegPresetOptions` ref，在 `watch(visible)` 中加载 FFmpeg 预设列表（`ffmpegPresetApi.list()` → `{ label: p.name, value: p.id }`）
3. 将「视频编码器」的 `n-input` 替换为 `n-select`，`:options` 绑定到 `videoEncoders`
4. 将「FFmpeg 预设」的 `n-input` 替换为 `n-select`，`:options` 绑定到 `ffmpegPresetOptions`

### verify

- `pnpm run build:base` 编译通过（确保无 TS 错误）
- 代码审查：确认新 import 路径正确，下拉框行为符合 Naive UI 规范

### done

- [ ] `AutoClipPresetDialog.vue` 中编码器和 FFmpeg 预设字段均为下拉选择器
- [ ] TypeScript 编译通过
