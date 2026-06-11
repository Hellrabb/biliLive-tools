# CHANGE: fix-autoclip-output-dir

## 背景

手动导出 autoclip 切片时 ffmpeg 报错：`Error opening output files: Invalid argument`。

## 根因

`cut()` 函数在输出路径为绝对路径时跳过 `parseSavePath`（其中包含 `fs.ensureDir`），导致目标目录不存在时 ffmpeg 无法创建输出文件。

## 修复

在 `cut()` 和 `mergeAssMp4()` 中显式添加 `await fs.ensureDir(path.dirname(outputPath))`，确保输出目录始终存在。

## 修改文件

- `packages/shared/src/task/video.ts` — 2 处 `fs.ensureDir` 添加

## 验证

- TypeScript: No errors
- Tests: 528 passed, 5 skipped
