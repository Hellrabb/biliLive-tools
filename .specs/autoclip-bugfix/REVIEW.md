# REVIEW — autoclip-bugfix

> 日期：2026-06-01
> 审查范围：c2a81c90..HEAD（8 commits，22 bugs）

---

## 第一轮 · Spec 合规审查

### AC 覆盖矩阵

| AC（来自 CHANGE.md） | 实现 | 测试 | 状态 |
|---|---|---|---|
| H1 定时器泄漏 | `exportPipeline.ts` setTimeout 移入 try 块 | `exportPipeline.test.ts` | ✅ |
| H2 取消返回空 ID | `service.ts` effectiveId 快照 | `service.test.ts` | ✅ |
| H3 retry 原子性 | `autoClip.ts` retryAndReschedule 单事务 | `service.test.ts` | ✅ |
| H4 openai provider | `sendMessage.ts` case "openai" 分支 | `sendMessage.test.ts` | ✅ |
| H5 abort resolve 已删文件 | `contentUnderstanding.ts` existsSync guard | `contentUnderstanding.test.ts` | ✅ |
| M1 重叠级联 | `boundaryRefiner.ts` while 回溯 | `boundaryRefiner.test.ts` | ✅ |
| M2 裁剪后重合并 | `signalDetector.ts` mergeTimeWindows 重调 | `signalDetector.test.ts` | ✅ |
| M3 双重 reject | `contentUnderstanding.ts` + `frameSampler.ts` settled guard | 两文件测试 | ✅ |
| M4 评分下限 clamp | `llmRanker.ts` Math.max(0, ...) | `llmRanker.test.ts` | ✅ |
| M5 上下文距离序 | `llmRanker.ts` distance sort | `llmRanker.test.ts` | ✅ |
| M6 TOCTOU 竞态 | `service.ts` capturedErr 重抛 | `service.test.ts` | ✅ |
| M7 原地变异 | `exportPipeline.ts` 展开运算符 | `exportPipeline.test.ts` | ✅ |
| M8 LLM 分页 | `danmakuFilter.ts` 3000 char 分批 | `danmakuFilter.test.ts` | ✅ |
| M9 abort 传播 | `frameSampler.ts` AbortError re-throw | `frameSampler.test.ts` | ✅ |
| M10 空 ID（同 H2） | 随 H2 修复 | `service.test.ts` | ✅ |
| L1 任务完成检测 | `exportPipeline.ts` close/exit 监听 | `exportPipeline.test.ts` | ✅ |
| L2 ASS 清理竞态 | `exportPipeline.ts` 延迟+try/catch | `exportPipeline.test.ts` | ✅ |
| L3 AbortSignal 传播 | `exportPipeline.ts` signal 传入 | `exportPipeline.test.ts` | ✅ |
| L4 重复 import | `exportPipeline.ts` cachedDiContainer | `exportPipeline.test.ts` | ✅ |
| L5 配置时序 | `service.ts` 管道前快照 | `service.test.ts` | ✅ |
| L6 轮询进度 | `AutoClipManagement/Index.vue` pollingProgress | 手动 | ✅ |
| L7 newEnd 边界 | `boundaryRefiner.ts` guard 1s保底 | `boundaryRefiner.test.ts` | ✅ |
| L8 过期索引 | `AutoClipPresetDialog.vue` findIndex(id) | 手动 | ✅ |
| DB 约束 | `db/autoClip.ts` migration v5 | `dbConstraint.test.ts` | ✅ |

### 范围蔓延检查

- [x] 未引入 CHANGE.md "范围排除"中列出的任何禁止项
- [x] 未新增功能特性
- [x] 未进行架构重构
- [x] 未新增 LLM provider（仅修复 openai 对称性）
- [x] 未改动禁动清单模块（init()、GlobalConfig、RecorderProvider、baseModel、AppConfig 签名均未变）

### 架构越界检查

- [x] 所有修改在 CHANGE.md 声明的"影响面"范围内
- [x] 新文件 `autoClip/autoClip.ts` 是薄 facade（9行 re-export），不影响架构
- [x] DB migration v5 使用既有迁移机制（auto_clip_schema_migrations 表），不改变 BaseModel 契约

**结论**：22 条 AC 全覆盖，0 范围蔓延，0 架构越界。✅ 通过。

---

## 第二轮 · 代码质量审查

### 2.0 TEST.md 完整性

- [x] 5 轮状态明确（2 ✅ + 2 ❌ + 2 ⚠️）
- [x] 跳过轮次均有理由
- [x] 第 1 轮每条 AC 有覆盖
- [x] 第 4 轮数据迁移验证完整

**结论**：TEST.md 符合要求。✅ 通过。

### 2.1 6 维衰退诊断（Path B：brooks-lint 未装，内置快查）

---

#### 🟢 R1 · Cognitive Overload：整体良好，个别可简化

**Symptom**：`danmakuFilter.ts` M8 修复中，`buildPrompt` 内联函数包含完整的 prompt 模板，逻辑清晰但与原有单次调用的 prompt 模板形成重复。

**Source**：McConnell · Code Complete · Chapter 7 — "High-quality routines should do one thing and do it well."

**Consequence**：当前代码可读性尚可，分页逻辑（batch split + offset tracking）最大嵌套深度 2 层，无认知过载。

**Remedy**：无需修改。当前实现 ≤40 行，batch loop 逻辑清晰。

---

#### 🟢 R2 · Change Propagation：隔离良好

**Symptom**：检查所有 15 个源文件修改，无跨模块意外依赖引入。

**Source**：Fowler · Refactoring · Divergent Change — "One reason to change" principle.

**Consequence**：无风险。每个 bug 修复仅影响相关模块，新增 `autoClip.ts` facade 为薄封装。

**Remedy**：无需修改。`git diff --stat` 确认实际变更文件 ⊆ TASK write_files。

---

#### 🟢 R3 · Knowledge Duplication：settled 模式值得抽象

**Symptom**：`contentUnderstanding.ts:67` 和 `frameSampler.ts` 中 `let settled = false` guard 模式完全一致。两处均在使用 `new Promise((resolve, reject) => { proc.on("close", ...); proc.on("error", ...); })` 的 spawn 模式。

**Source**：Hunt & Thomas · The Pragmatic Programmer · DRY Principle — "Every piece of knowledge must have a single, unambiguous, authoritative representation."

**Consequence**：如果未来需要修改 settled guard 的行为（如加超时或日志），需要改两处。但由于这两处各自管理独立的 Promise 生命周期，强行抽象成工具函数反而会引入耦合。

**Remedy**：不修。这是**同一模式的两次独立使用**，不是"同一个决定的重复表达"。抽象会增加间接层且收益低。

---

#### 🟢 R4 · Accidental Complexity：简洁适度

**Symptom**：`danmakuFilter.ts` M8 分页逻辑中 `MAX_BATCH_CHARS = 3000` 为硬编码常量；`buildPrompt` 函数为闭包内联。

**Source**：Ousterhout · A Philosophy of Software Design · Chapter 4 — "Modules should be deep: simple interfaces with complex implementations."

**Consequence**：3000 字符阈值合理（对应 ~750 tokens，GPT-3.5/4 上下文窗口充裕），无溢出风险。未来若模型上下文缩小可提为配置。

**Remedy**：不修。当前值实用，提取为配置项属于"以后可能用到"的过度设计。

---

#### 🟡 R5 · Dependency Disorder：`autoClip.ts` facade 引入间接层

**Symptom**：新文件 `packages/shared/src/autoClip/autoClip.ts`（9 行）只是 `export { autoClipModel } from "../db/index.js"` 的 re-export。调用方 `routes/autoClip.ts` 通过此 facade 获取 `retryAndReschedule`。

**Source**：Martin · Clean Architecture · Chapter 22 — "The dependency rule says that source code dependencies can only point inwards."

**Consequence**：这层间接引入了一个中间模块，其唯一职责是打破 DI 容器注入限制。`exportPipeline.ts` 的 `ExportClipByIdDeps` 接口需要 `retryAndReschedule` 函数，但 DI 容器不直接暴露它。Facade 是务实方案，但增加了依赖链路长度：`routes → autoClip.ts → db/index → db/autoClip.ts`。

**Remedy**：可接受。Facade 9 行不会成为维护负担。替代方案（修改 DI 容器注册）会影响 `init()` 签名（禁动清单），风险更大。

---

#### 🟢 R6 · Domain Model Distortion：命名精准

**Symptom**：检查所有新增标识符是否反映业务领域。

**Source**：Evans · Domain-Driven Design · Chapter 2 — "The model and the heart of the design shape each other."

**Consequence**：无扭曲。关键命名评估：
- `effectiveId` — 清晰表达"实际使用的 ID"（vs `params.id` 可能为空）
- `settled` — 精确描述 Promise 状态（已决议，不可再决议）
- `retryAndReschedule` — 动词准确（先 retry inc 再 schedule 到 pending）
- `pollingProgress` — 轮询进度
- `capturedErr` — 捕获的错误快照
- `beforeCandidates` / `afterCandidates` — 候选集（尚未截断）

**Remedy**：无需修改。

---

### 2.2 架构依赖检查

**触发判定**：未新增/重命名顶级模块，无危险 import，无新中间件。不触发本段。

---

## 第三轮 · UI 视觉审查

**跳过**。后端/lib 项目。T05 中 Vue 变更仅涉及 `findIndex(id)` 替代数组 index 查找（L8）和 `pollingProgress` 字符串显示（L6），无视觉层改动。

---

## 第四轮 · 补充审查

### 4.1 技术债评估

**未命中触发条件**。非里程碑/大版本/重构项目。

### 4.2 跨模型 spot-check

**未命中触发条件**。无安全/认证变更、无并发/分布式变更、无 >80 行函数改动、无测试覆盖率下降。

---

## 审查结论

| 轮次 | 结果 | 发现 |
|---|---|---|
| 第一轮 · Spec 合规 | ✅ 通过 | 22 AC 全覆盖，0 蔓延 |
| 第二轮 · 代码质量 | ✅ 通过 | 1 个 🟡 Major（R5 facade 间接层），0 个 🔴 Critical |
| 第三轮 · UI | ⏭️ 跳过 | 后端项目 |
| 第四轮 · 补充 | ⏭️ 跳过 | 均未命中触发条件 |

### 🟡 Major 问题

| 编号 | 维度 | 描述 | 建议 |
|---|---|---|---|
| R5-DD-01 | R5 依赖混乱 | `autoClip/autoClip.ts` facade 引入一个仅 9 行 re-export 的中间模块 | 可接受。替代方案需改 DI 容器（禁动清单），风险更大 |

### 🔴 Critical 问题

无。

---

## 最终判定

**✅ 通过。0 个 Critical，1 个已知接受的 Major。**

可直接进入 INTEGRATION（7-integration）。
