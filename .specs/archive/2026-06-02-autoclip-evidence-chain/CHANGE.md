# CHANGE — autoclip-evidence-chain

> 生成日期：2026-06-02
> 来源：autoclip-bugfix 审查发现（范围蔓延）+ 已有设计文档

## Why

当前 autoclip 切片结果是一个"黑盒"——用户和开发者只能看到最终的高光片段列表，无法理解 AI 为什么选中/没选中某个片段。当切片效果不佳时需要反复猜测调参，缺乏可解释性。

切片决策链路中实际包含丰富的中间数据（弹幕密度曲线、信号检测详情、LLM 评分依据、边界精修记录），但这些数据在 pipeline 运行后被丢弃，既不持久化也不暴露给前端。

## What

在 autoclip pipeline 各阶段**捕获决策证据**，结构化存储到 DB，通过 HTTP API 暴露，前端新增可视化面板展示完整证据链。

### 证据链包含

| 阶段     | 证据         | 数据                                         |
| -------- | ------------ | -------------------------------------------- |
| 信号检测 | 弹幕密度曲线 | 时间-密度数据点数组（用于时序图渲染）        |
| 信号检测 | 触发弹幕样本 | 每个候选窗口内的代表性弹幕（时间/内容/用户） |
| 信号检测 | 信号检测详情 | 实际密度 vs 阈值、信号来源、合并窗口信息     |
| 边界精修 | 精修前后对比 | 原始窗口起止 → 精修后起止 + 调整原因         |
| LLM 排序 | 评分详情     | 每个片段的分数、高光类型、评分理由、标签     |

### 各层变更

- **`types.ts`**：新增 `Evidence`、`BoundaryRefinement` 接口，`AutoClipResult` 加 `evidence?: Evidence`
- **`signalDetector.ts`**：`detectDanmakuDensityPeaks` 返回值加 `buckets: DensityBucket[]`
- **`boundaryRefiner.ts`**：`refineBoundaries` 返回值改为 `{ highlights, refinements }`，含精修前后对比
- **`pipeline.ts`**：新增 `buildEvidence()` 调用，在管线各阶段收集证据数据
- **`evidence.ts`**（新文件）：`buildEvidence()` 函数，组装完整 Evidence 对象
- **`service.ts`**：`analyzeAndSave` 保存 evidence JSON 到 DB
- **`db/autoClip.ts`**：migration v6 加 `evidence` TEXT 列
- **`routes/autoClip.ts`**：`parseEvidenceSafe()` 解析 evidence 列，`GET /clips` 和 `GET /clips/:id` 返回 evidence
- **`EvidencePanel.vue`**（新组件）：完整可视化——密度曲线图、触发弹幕列表、信号参数、精修对比、评分卡片
- **`AutoClipManagement/Index.vue`**：master-detail 布局，点击行选中 + 右侧 EvidencePanel

## 影响面

- `packages/shared/src/autoClip/` — 核心变更（types、pipeline、signalDetector、boundaryRefiner、evidence.ts）
- `packages/shared/src/db/autoClip.ts` — DB migration v6
- `packages/http/src/routes/autoClip.ts` — API 响应加 evidence 字段
- `packages/app/src/renderer/src/pages/AutoClipManagement/` — EvidencePanel + master-detail 布局
- `packages/shared/test/autoClip/` — 所有受影响的测试更新 + 新测试

## 范围排除

- **不做**：新增 LLM provider 或修改 LLM 调用逻辑
- **不做**：修改 autoclip preset 配置结构（evidence 是自动捕获，无需用户配置）
- **不做**：证据数据的导出/下载功能
- **不做**：证据链的搜索/过滤/对比功能
- **不做**：跨切片证据对比分析

## 验收线

1. pipeline 完成后 evidence 数据完整（5 类证据齐全）
2. evidence 正确序列化到 DB（migration v6 幂等）
3. `GET /clips` 和 `GET /clips/:id` 返回 evidence 字段
4. 前端 EvidencePanel 渲染密度时序图 + 触发弹幕 + 信号详情 + 精修对比 + 评分卡片
5. `pnpm run test` 全部通过（含新增 evidence 测试）
6. `pnpm run build:base` + `pnpm run build:app` 构建成功
7. 已有 API 调用方不受影响（evidence 为可选字段）

## 路径建议

功能涉及新类型、新 DB schema、新 API 字段、新前端组件 → 走**完整路径**：

```
CHANGE → REQUIREMENT → DESIGN → TASK → DEV → TEST → REVIEW → INTEGRATION
```

## 当前状态

`feature/autoclip-evidence-chain` 分支上有一个 WIP commit（7a2c7506），包含后端大部分代码 + 格式化变更。但该 commit 混杂了不相关文件，需要在 DEV 阶段清理（`git reset HEAD~1` 后选择性重新提交）。
