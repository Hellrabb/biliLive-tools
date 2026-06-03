# REQUIREMENT — autoclip-evidence-chain

- **Change ID**: `autoclip-evidence-chain`
- **关联**: `CHANGE.md`、`CONTEXT.md`

---

## 用户故事

- **US-1**：作为直播主/切片发布者，我想查看每个切片结果背后的决策证据（为什么选中这个片段、信号密度如何、LLM 怎么评分），以便理解 AI 的判断逻辑，辅助调整自动切片参数。
- **US-2**：作为开发者/维护者，我想在 autoclip pipeline 运行后查看各阶段的中间数据（弹幕密度曲线、信号检测阈值、边界精修前后对比），以便调试误判和优化管线参数。
- **US-3**：作为前端用户，我想在切片管理页面点击某个切片后，在右侧面板看到完整的可视化证据（密度图、弹幕列表、精修对比、评分卡片），以便直观理解该切片的决策过程。

## 验收准则（AC）

### AC-1 · Pipeline 证据捕获完整性

- **Given** autoclip pipeline 完成一次完整的分析（信号检测 → 排序 → 边界精修 → 标题生成）
- **When** pipeline 返回 `AutoClipResult`
- **Then** `result.evidence` 包含以下 5 类数据：
  - `danmakuDensityCurve`：时间-密度数据点数组，长度 > 0
  - `triggerDanmaku`：触发弹幕样本数组，含时间偏移/内容/用户
  - `signalDetails`：实际密度、阈值、信号来源列表
  - `boundaryRefinement`：若边界精修阶段运行，含原始 vs 精修后边界对比；否则为 null
  - `llmScores`：每个高光片段的评分/类型/理由/标签
- **验证方式**: `cd packages/shared && pnpm run test -- autoClip/pipeline.test.ts`（新增 evidence 断言）

### AC-2 · 证据链 DB 持久化

- **Given** pipeline 返回含 evidence 的 `AutoClipResult`
- **When** `AutoClipService.analyzeAndSave` 保存结果
- **Then** `auto_clip_results` 表的 `evidence` 列包含该结果的 JSON 序列化证据
- **验证方式**: `cd packages/shared && pnpm run test -- autoClip/dbConstraint.test.ts`（新增 evidence 列写入/读取测试）

### AC-3 · DB Migration v6 幂等

- **Given** 已有 auto_clip_results 表（可能已有数据）
- **When** 启动应用触发 migration v6（`ALTER TABLE ADD COLUMN evidence TEXT`）
- **Then** migration 不报错；已存在的行 evidence 为 NULL；新插入的行可写入 evidence
- **验证方式**: 重复启动应用两次，migration 不报错

### AC-4 · HTTP API 返回 evidence

- **Given** DB 中存在一条含 evidence JSON 的切片结果
- **When** 调用 `GET /api/auto-clip/clips` 和 `GET /api/auto-clip/clips/:id`
- **Then** 响应中的每个 clip 对象包含 `evidence` 字段（解析后的 JSON 对象或 null）
- **验证方式**: `cd packages/http && pnpm run test`（手动 HTTP 测试或集成测试）

### AC-5 · API 容错

- **Given** DB 中某行的 evidence 列包含损坏的 JSON 字符串
- **When** 调用 `GET /api/auto-clip/clips`
- **Then** 该行的 `evidence` 返回 `null`，不导致整个请求 500
- **验证方式**: 单元测试 `parseEvidenceSafe` 覆盖损坏 JSON 输入

### AC-6 · 前端证据面板渲染

- **Given** 用户在 AutoClipManagement 页面看到切片列表
- **When** 用户点击某一行切片
- **Then** 页面右侧出现 EvidencePanel，展示：
  - 弹幕密度时序图（时间轴 + 密度柱/线）
  - 触发弹幕列表（时间/内容/用户）
  - 信号检测详情（密度阈值/信号来源/合并窗口）
  - 边界精修对比（原始起止 ↔ 精修后起止 + 原因）
  - LLM 评分卡片（分数/高光类型/理由/标签）
- **验证方式**: 手动 UAT（启动 Electron app，打开 AutoClipManagement，点击切片行）

### AC-7 · 无证据时的降级展示

- **Given** 某个切片结果的 evidence 为 null（旧数据或捕获失败）
- **When** 用户点击该切片行
- **Then** EvidencePanel 显示"暂无决策证据"占位提示，不报错、不白屏
- **验证方式**: 手动 UAT（选中一条旧切片数据）

### AC-8 · 构建与回归

- **Given** 所有代码变更完成
- **When** 运行 `pnpm run test` 和 `pnpm run build:base`
- **Then** 全部测试通过，构建成功，无新增 TS 类型错误
- **验证方式**: CI/CD

---

## 范围切分

### v1（本次必做）

- 后端证据捕获 5 类数据（密度曲线/触发弹幕/信号详情/边界精修/LLM评分）
- DB migration v6（evidence TEXT 列）
- HTTP API evidence 字段 + 容错解析
- 前端 EvidencePanel 组件（完整可视化）
- AutoClipManagement master-detail 布局
- 全部测试覆盖

### v2（下一轮考虑）

- 弹幕密度曲线交互式缩放/拖拽
- 证据数据导出（JSON/PDF）
- 跨切片证据对比视图
- evidence 列索引优化（如需按 evidence 内容查询）

### out（永远不做）

- 证据链的实时流式更新（WebSocket 推送 pipeline 进度）
- 基于证据链的自动参数调优
- 证据链的搜索/过滤功能

---

## 非功能性需求

- **性能**: 证据数据 ≤ 500KB/切片（含弹幕密度曲线全量数据），前端渲染延迟 ≤ 1s
- **可访问性**: 无（内部工具，非公网产品）
- **安全**: evidence JSON 解析需容错（损坏数据不导致崩溃）；无新增鉴权/加密
- **兼容性**: Electron 桌面应用，无需跨浏览器兼容；DB migration v6 需向下兼容已有数据
- **可观测性**: evidence 构建失败时 logger.warn（不阻塞 pipeline）；API evidence 解析失败时 logger.warn

## 依赖与假设

- **依赖**: 已有 `AutoClipResult` 接口、`auto_clip_results` 表、`BaseModel` migration 机制、Naive UI 组件库
- **假设**: SignalDetector 的 `detectDanmakuDensityPeaks` 已返回 densityBuckets（WIP commit 中已完成此变更）
- **假设**: BoundaryRefiner 的 `refineBoundaries` 已返回 refinements（WIP commit 中已完成此变更）
- **假设**: 前端已有图表库或可用 Canvas/SVG 实现密度时序图（如无则用 Naive UI 的简易图表或引入轻量图表库）
