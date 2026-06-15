# CHANGE — 修复 AutoClip "打开视频" 功能

## Why

当前 AutoClip 管理页面的"打开视频"按钮存在两个问题：

1. **传参错误**：直接 `router.push({ path: "/videoPlayer", query: { source: ... } })` 跳转，但 `VideoPlayer` 页面读取的是 `videoId` + `type`，从未读 `source`。导致 videoId 为空，播放器无法加载视频（可能回退显示 B站默认控件）。
2. **不支持切片视频**：始终打开源视频 `row.video_path`，但用户导出切片后期望打开的是已导出的切片文件（`exported_paths`）。当存在多个分P切片时，应提供列表让用户选择播放。

## What

修复"打开视频"按钮，使其：

- ✅ 通过 `toVideoPlayerPage()` 工具函数正确跳转到视频播放页（先 `applyVideoId` 注册视频路径，获取正确 videoId）
- ✅ 当切片已导出（`status === 'exported'`）且有 `exported_paths` 时，弹出播放列表让用户选择要播放的切片文件
- ✅ 当切片未导出时，回退到打开源视频（`video_path`）
- ✅ 播放列表始终展示（不管 1 个还是多个切片），让用户可以确认打开哪个文件

## 影响面

| 影响项                                                             | 说明                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `packages/types/src/index.ts`                                      | `AutoClipClipRow` 类型增加 `exported_paths?: string \| null`                               |
| `packages/app/src/renderer/src/pages/AutoClipManagement/Index.vue` | `ClipRow` 接口 + 数据映射 + "打开视频"按钮逻辑重写 + 新增播放列表弹窗                      |
| `packages/app/src/renderer/src/utils/pages.ts`                     | 可能需要扩展 `toVideoPlayerPage` 支持传入已注册的 `videoId`（避免重复调用 `applyVideoId`） |

**不影响**：后端 API（`exported_paths` 已在 `/clips` 响应中通过 `...rest` 返回）、数据库 schema、导出管线。

## 范围排除

- ❌ 不修改 VideoPlayer 页面本身
- ❌ 不修改导出管线
- ❌ 不在播放列表中加入弹幕文件选择（保持简单）
- ❌ 不处理 `isWeb` 环境下的 `openExternal`（沿用现有 `toVideoPlayerPage` 的窗口创建逻辑）

## 验收线

- [ ] "打开视频"按钮点击后能正常跳转到 VideoPlayer 页面并加载视频
- [ ] 已导出切片（有 `exported_paths`）时，弹出播放列表弹窗，列出所有切片文件
- [ ] 播放列表中选中某个切片后可正常播放
- [ ] 未导出切片时，打开源视频
- [ ] 源视频文件类型为 `.ts` 时给予适当提示（走 `toVideoPlayerPage` 的已有逻辑）
