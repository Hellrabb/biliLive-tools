# T01 · 修复「编辑此预设 →」按钮无响应

- **Change ID**: fix-autoclip-ffmpeg-edit-preset
- **完成时间**: 2026-06-10

## 修改历程

| 版本       | 问题                                              |
| ---------- | ------------------------------------------------- |
| 原始       | `router.push` 执行了但被模态框遮挡 → 用户看不到   |
| 第一版修复 | 关弹窗 + `router.push` → 页面退出，用户丢失上下文 |
| **最终版** | **仅关弹窗**，留在原地                            |

## 最终修改

| 文件                                                                | 改动                                                      | 行号     |
| ------------------------------------------------------------------- | --------------------------------------------------------- | -------- |
| `packages/app/src/renderer/src/components/AutoClipPresetDialog.vue` | `@click="router.push(...)"` → `@click="editFfmpegPreset"` | L298     |
| 同上                                                                | 新增 `editFfmpegPreset()`：`visible.value = false`        | L732-734 |
| 同上                                                                | 移除 `import { useRouter } from "vue-router"` (未使用)    | L584     |
| 同上                                                                | 移除 `const router = useRouter()` + HACK 注释 (未使用)    | L735-736 |

净变更：+4 行 / -8 行

## 验证

- `npx tsc --noEmit` 通过
- Docker `build:webui` 编译通过
- UAT-1 通过
