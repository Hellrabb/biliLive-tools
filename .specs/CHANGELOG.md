# CHANGELOG.md — biliLive-tools

> 所有已归档 change 的时间线。

| 日期       | Change ID                         | 摘要                                                                                                                 | LESSONS           |
| ---------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------- | --- |
| 2026-06-14 | fix-accurate-seek-preset-fallback | accurateSeek 真精确 seek + re-export preset default 兜底                                                             | L-seek, L-config  |
| 2026-06-14 | fix-cover-gray-frame              | 修复自动封面截帧灰帧：frameSampler 加入 padded output seek（同 accurateSeek 模式）                                   | L-cover           |
| 2026-06-13 | fix-autoclip-encoder-batching     | 修复 encoder 优先级（硬编码 libx264 覆盖 GPU 编码器）+ daily batching 竞态条件（Promise 锁替代裸 number）            | L-encoder, L-race |
| 2026-06-12 | fix-autoclip-output-dir           | 修复 autoclip 手动导出 ffmpeg 报 Invalid argument：cut/mergeAssMp4 添加输出目录创建                                  | —                 |
| 2026-06-11 | fix-autoclip-three-bugs           | 修复 autoclip 3 bugs: 同天切片聚合上传 + accurateSeek 防灰帧 + {{title}} 模板变量                                    | L-R3, L-R6        |
| 2026-06-11 | fix-autoclip-three-bugs           | 修复 autoclip 3 bugs: 同天切片聚合上传 + accurateSeek 防灰帧 + {{title}} 模板变量                                    | L-R3, L-R6        |
| 2026-06-11 | autoclip-bili-part-upload         | AutoClip B站上传改为单稿件分P：N切片→1视频N分P + 封面首个切片截帧 + 模板变量扩展 user/roomId                         | —                 |
| 2026-06-11 | fix-autoclip-nonapproval-list     | 修复非审批模式自动切片结果在管理列表不可见（+已批准筛选tab +keep-alive刷新 +reExport API）                           | —                 |
| 2026-06-10 | fix-docker-build-typecheck        | 修复 Docker build:webui 失败：补 BoundaryRefineConfig.overlapMergeThreshold + editingPreset null guard               | —                 |
| 2026-06-10 | autoclip-bili-upload-params       | AutoClip B站上传模板字段补齐：BiliUpTemplateConfig 从 8 字段扩展到 30+ 字段，对齐 BiliupConfig，前端新增高级设置面板 | —                 |
| 2026-06-10 | fix-autoclip-ffmpeg-edit-preset   | 修复 AutoClip 导出设置中 FFmpeg「编辑此预设 →」按钮点击无反应（弹窗遮挡路由跳转）                                    | —                 |
| 2026-06-09 | autoclip-ffmpeg-custom            | AutoClip FFmpeg 预设：下拉分组显示内置+自定义、选中后参数预览、encoder 自动同步、跳转链接                            | —                 |
| 2026-06-05 | autoclip-context-slicing          | AutoClip 边界精修独立模型配置：新增 boundaryRefineModelId 字段，支持为 Phase 1.6 指定专用 LLM 模型                   | —                 |
| 2026-06-05 | autoclip-encoder-selector         | AutoClip 导出设置：编码器和 FFmpeg 预设从文本输入改为下拉选择，支持直接选取 NVENC/QSV/AMF                            | —                 |
| 2026-06-05 | health-fix-2026-06                | 健康巡检修复：better-sqlite3 原生模块重编译、ESLint 配置修复、未使用依赖清理、覆盖率工具安装                         | 环境修复          |
| 2026-06-02 | autoclip-evidence-chain           | autoclip 证据链功能：pipeline 决策数据捕获、DB 存储、API 暴露、前端 EvidencePanel 可视化                             | —                 |
| 2026-06-08 | autoclip-upload-template-ui       | B站稿件上传模板集成到 autoclip 预设页面 + 封面自动提取                                                               | feature/auto-clip | —   |
