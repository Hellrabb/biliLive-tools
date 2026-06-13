# CHANGE: revert-padded-seek-video

## 背景

之前错误地将 padded output seek（`-ss <t-1> -i video -ss 1`）应用于视频导出，
此改动多余且有害。

## 根因分析

1. ffmpeg transcoding 模式默认启用 `-accurate_seek`，自动解码并丢弃关键帧
   到目标点之间的帧，无需手动输出 -ss
2. 灰帧的真正根因是 `-copyts`（某些编码器在非零时间戳初始化产生坏帧）
3. 手动 padded seek 在关键帧离目标较远时可能导致视频从错误位置开始，
   引入不该存在的音视频片段

## 修复

回退 genMergeAssMp4Command 中的 padded seek，只保留：

- 去掉 `-copyts`（修复灰帧）
- 输出 `-to` 替代输入 `-to`（因 -copyts 移除后输入 -to 语义变化）

## 保留

frameSampler.extractOneFrame 保留 padded seek，因为 `-vframes 1` 单帧
提取不走 `-accurate_seek` 路径。

## 修改文件

- task/video.ts: 回退 padded seek
- test/task/video.test.ts: 恢复测试期望值

## 验证

- 全量: 944 tests passed
