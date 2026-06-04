# CHANGELOG.md — biliLive-tools

> 所有已归档 change 的时间线。

| 日期       | Change ID                 | 摘要                                                                                               | LESSONS  |
| ---------- | ------------------------- | -------------------------------------------------------------------------------------------------- | -------- |
| 2026-06-05 | autoclip-context-slicing  | AutoClip 边界精修独立模型配置：新增 boundaryRefineModelId 字段，支持为 Phase 1.6 指定专用 LLM 模型 | —        |
| 2026-06-05 | autoclip-encoder-selector | AutoClip 导出设置：编码器和 FFmpeg 预设从文本输入改为下拉选择，支持直接选取 NVENC/QSV/AMF          | —        |
| 2026-06-05 | health-fix-2026-06        | 健康巡检修复：better-sqlite3 原生模块重编译、ESLint 配置修复、未使用依赖清理、覆盖率工具安装       | 环境修复 |
| 2026-06-02 | autoclip-evidence-chain   | autoclip 证据链功能：pipeline 决策数据捕获、DB 存储、API 暴露、前端 EvidencePanel 可视化           | —        |
