# CHANGE: fix-autoclip-encoder-batching

## 背景

autoclip 导出使用 CPU 编码器（libx264）而非 GPU 编码器（h264_nvenc），且同一天切片分P上传偶尔失效。

## Bug 列表

### B1: GPU 编码器未生效

- **根因**: AUTO_CLIP_DEFAULT_CONFIG.export.encoder 硬编码为 "libx264"，每个新建 autoclip 预设继承此值。exportPipeline 中原优先级 `exportConfig.encoder > ffmpegPreset.encoder` 导致硬编码默认值始终覆盖 ffmpeg 预设中的 h264_nvenc。
- **修复**:
  1. AUTO_CLIP_DEFAULT_CONFIG: encoder 改为 "" (falsy)
  2. exportPipeline: 颠倒优先级为 `ffmpegPreset.encoder || exportConfig.encoder || "libx264"`，使用 `||` 而非 `??` 正确处理空字符串

### B2: 每日分P上传偶尔失效（竞态条件）

- **根因**: addMedia 返回后才异步注册 task-end 监听获取 AID。两次导出几乎同时完成时，第二次在第一次注册监听前检查 Map，看不到 AID → 重复创建新投稿。
- **修复**: dailyUploadAids 值类型从 `number` 改为 `Promise<number>`。在 await addMedia 之前写入 pending Promise 占位，第二次导出检查 Map 看到 Promise → await 等待 → editMedia 追加。

## 修改文件

- `presets/autoClipPreset.ts`: encoder 默认值 ""
- `autoClip/exportPipeline.ts`: encoder 优先级颠倒
- `autoClip/service.ts`: dailyUploadAids Promise-based 锁
- `test/autoClip/service.test.ts`: 更新测试匹配 Promise 类型
