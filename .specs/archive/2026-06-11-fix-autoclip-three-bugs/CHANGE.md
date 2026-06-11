# CHANGE: fix-autoclip-three-bugs

## 背景

用户反馈 autoclip 自动切片功能存在 3 个 bug。

## Bug 列表

### B1: 同一天切片分散在多个投稿

- **现象**: 同一天的直播被拆成多个录制文件，每个文件独立触发 autoclip 分析+上传，导致同一天切片出现在多个 B站投稿中
- **期望**: 和录制上传一样，同一天的切片聚合到同一个投稿（分P）

### B2: 切片首帧灰色/坏帧

- **现象**: 切片导出后第一帧显示为灰色坏帧，播放几帧后才正常
- **根因**: ffmpeg re-encode 时使用 `-copyts` 保留了 open-GOP 关键帧前的坏帧

### B3: `{{title}}` 模板变量未解析

- **现象**: autoclip 标题模板中使用 `{{title}}`，上传后仍显示 `{{title}}` 字面值
- **根因**: autoclip 的 `TemplateContext` 只有 `highlightTitle`，缺少 `title`（直播标题）

## 修改范围

- `packages/types/src/index.ts` — FfmpegOptions 新增 `accurateSeek`
- `packages/shared/src/task/video.ts` — `genMergeAssMp4Command` 支持 accurateSeek
- `packages/shared/src/autoClip/exportPipeline.ts` — 设置 accurateSeek: true
- `packages/shared/src/autoClip/templateRenderer.ts` — TemplateContext 新增 title
- `packages/shared/src/autoClip/service.ts` — 每日批量上传 + title 元数据提取
