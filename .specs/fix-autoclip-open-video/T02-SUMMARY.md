# T02-SUMMARY

> Change: `fix-autoclip-open-video`
> 日期: 2026-06-15

## 做了什么

`packages/app/src/renderer/src/pages/AutoClipManagement/Index.vue`:

1. **重写"打开视频"按钮**：`onClick` 从直接 `router.push({ query: { source } })` 改为 `openVideo(row)`
2. **新增 `openVideo()` 函数**：
   - 已导出（`status === 'exported'`）且 `exportedPaths` 非空 → 弹出播放列表
   - 否则 → `toVideoPlayerPage({ videoFilePath: row.video_path })`
3. **新增播放列表弹窗**：`NModal` + `NList`/`NListItem`
   - 列表项前缀 P1/P2/P3... 标签
   - 文件名显示 basename（`split('/').pop()`）
   - 点击 → 关闭弹窗 + `toVideoPlayerPage({ videoFilePath })`
   - 取消按钮关闭弹窗
4. 删除未使用的 `useRouter` import 和 `router` 常量
5. 新增 `toVideoPlayerPage` import from `@renderer/utils/pages`

## verify 输出

```
vue-tsc --noEmit: No errors in AutoClipManagement ✅
（预存 ArtPlayer 类型错误在 VideoCut/composables/useVideoPlayer.ts，与本次无关）
```

## 验收对照

| AC                                            | 状态                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| "打开视频"按钮正常跳转 VideoPlayer 并加载视频 | ✅ `toVideoPlayerPage()` 内部调 `applyVideoId` → `createSubWindow`      |
| 已导出切片弹出播放列表                        | ✅ `status === 'exported'` + `exportedPaths.length > 0` → 弹窗          |
| 播放列表选中后正常播放                        | ✅ `handlePlaylistSelect` → `toVideoPlayerPage({ videoFilePath })`      |
| 未导出切片打开源视频                          | ✅ 回退分支 `toVideoPlayerPage({ videoFilePath: row.video_path })`      |
| ts 文件提示                                   | ✅ `toVideoPlayerPage` 内部已有 `throw new Error("ts文件暂不支持播放")` |

## 6 维自查

✅ 沿用既有抽象 grep（R6.4）：

- 视频跳转: `toVideoPlayerPage` 是既有工具函数（`@renderer/utils/pages.ts`）→ 沿用
- 弹窗模式: 参照现有 `previewVisible`/`showDanmuDialog` 的 `NModal` 模式
- 错误处理: 沿用 `notice.error()` 通知模式
- 文件命名显示: 参照 `previewItem.video_path` 的直接显示方式

✅ R1 认知过载: `openVideo()` 12 行，`handlePlaylistSelect()` 5 行，无嵌套 > 2 层
✅ R2 变更传播: 仅 Index.vue，无其他文件改动
✅ R3 知识重复: 无
✅ R4 偶然复杂: 无
✅ R5 依赖混乱: 无
✅ R6 领域扭曲: 无

## 越界检查（R6.5）

✅ TASK write_files：1 项

- packages/app/src/renderer/src/pages/AutoClipManagement/Index.vue

✅ 实际 diff 涉及：1 项（同上）
✅ 越界：0

## 破坏性变更

无。仅替换内部实现，不改变对外接口。
