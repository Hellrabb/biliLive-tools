# CHANGE: fix-accurate-seek-preset-fallback

## B1: accurateSeek 间歇性灰帧

### 根因

之前的 accurateSeek 只"去掉 -copyts + 输出 -to"，但 ffmpeg 仍输出输入 -ss 关键帧之后的 **所有** 解码帧。关键帧到目标时间点之间的坏帧（open-GOP 灰帧）未被跳过。"间歇性"取决于关键帧是否恰好破损。

### 修复

padded seek 模式（与 frameSampler 同）:

- ss >= 1s: `-ss <ss-1> -i video -ss 1 -to <to-ss+1>`
- ss < 1s: `-ss 0 -i video -ss <ss> -to <to>`

输入 seek 跳到目标前 1s 的关键帧，输出 -ss 跳过关键帧到目标点之间的帧（含坏帧），输出 -to 保证正确时长。

### 影响面审计

- `accurateSeek` 仅在 `exportClips` 中设为 true
- `genFfmpegParams` 已有 `!options.accurateSeek` 守卫，不产生重复输出 -ss
- `transcode`/`mergeAssMp4` 其他调用方不受影响
- `addTimestamp` 不兼容（JSDoc 已声明），autoclip 不使用
- 进度条计算使用原始 ss/to，略有偏移（cosmetic）

## B2: 手动导出 encoder 回退到 libx264

### 根因

容器中 `container.resolve("appConfig")` 的 `videoCut.autoClipPresetId` 为空（编译默认，未持久化），导致 global fallback 跳过。`exportConfig` 保留编译默认（ffmpegPresetId="default"），resolveExportPresets 加载 default ffmpeg 预设 → encoder=libx264。

### 修复

`doExportClips` 增加第三层兜底——globalPresetId 为空时尝试加载 "default" 预设。容器中 autoClipPresets.json 的 "default" 已配置 hevc_nvenc 的 ffmpeg 预设。

## 修改文件

- `task/video.ts`: padded seek 替换原 accurateSeek
- `autoClip/exportPipeline.ts`: "default" preset 兜底
- `test/task/video.test.ts`: 更新 accurateSeek 测试期望值

## 验证

- 全量回归: 944 tests passed
- TypeScript: no errors
