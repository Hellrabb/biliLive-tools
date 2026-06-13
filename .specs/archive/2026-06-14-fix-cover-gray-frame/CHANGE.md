# CHANGE: fix-cover-gray-frame

## 背景

accurateSeek 修复了视频导出的灰帧问题，但自动封面截帧使用 `frameSampler.extractOneFrame`，独立于 `genMergeAssMp4Command`，仍受 open-GOP 关键帧灰帧影响。

## 根因

`extractOneFrame` 仅用 `-ss` 作为输入选项（keyframe seek），未做 padded output seek。

## 修复

Padded seek 模式（与 accurateSeek 一致）:

- timestamp >= 1s: `-ss <t-1> -i video -ss 1` 从 1 秒前关键帧解码，跳过坏帧
- timestamp < 1s: `-ss 0    -i video -ss <t>` 从起始解码

## 修改文件

- `autoClip/frameSampler.ts` — extractOneFrame 参数
- `test/autoClip/frameSampler.test.ts` — 2 测试更新

## 验证

- 370 tests passed
