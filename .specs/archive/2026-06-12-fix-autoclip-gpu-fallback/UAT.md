# UAT: fix-autoclip-gpu-fallback

## UAT-1 · GPU 编码验证

- **前置**: 运行环境装有 NVIDIA GPU + nvenc 驱动，或 Intel QSV，autoclip 预设中 encoder 设为对应硬件编码器（如 `h264_nvenc`）
- **步骤**:
  1. 启动 biliLive-tools
  2. 触发一次 autoclip 导出（自动或手动均可）
  3. 导出过程中观察 GPU 使用率（`nvidia-smi` / `intel_gpu_top` / 任务管理器）
  4. 导出完成后检查日志中 ffmpeg 命令行是否包含硬件编码器（`-c:v h264_nvenc`）且不包含重复的 `-ss` 输出选项
- **期望**:
  - GPU 使用率在导出期间有显著上升
  - ffmpeg 日志中无重复 `-ss` 输出选项（仅应有输入 `-ss`）
  - 导出速度明显快于纯 CPU 编码
- **通过/失败**:

---

## UAT-2 · 非 GPU 模式不受影响

- **前置**: autoclip 预设中 encoder 设为 `libx264`（CPU 编码）
- **步骤**:
  1. 触发一次 autoclip 导出
  2. 确认导出成功且首帧无灰帧
  3. 确认输出视频时长与高光片段时长一致
- **期望**:
  - 导出正常完成，无报错
  - 首帧正常（无灰帧）
  - 视频时长正确
- **通过/失败**:
