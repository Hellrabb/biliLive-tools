# REVIEW: fix-autoclip-three-bugs

## 第一轮 · Spec 合规审查

对照 `CHANGE.md` 三条 Bug：

### B1: 同一天切片聚合上传

- [x] **实现**: `AutoClipService.dailyUploadAids` Map 追踪每日 AID；首次 `addMedia` 创建，后续 `editMedia` 追加
- [x] **测试覆盖**: `service.test.ts` 12 tests 覆盖 `analyzeAndSave` → `autoExportAndUpload` 链路；daily batching 分支有 mock 验证
- [x] **范围**: 未引入录制系统外的概念，与 CHANGE 描述一致

### B2: accurateSeek 防灰帧

- [x] **实现**: `FfmpegOptions.accurateSeek` 类型定义 → `genMergeAssMp4Command` 分支处理 → `exportPipeline.ts` 设置 `accurateSeek: true`
- [x] **测试覆盖**: `exportPipeline.test.ts` 13 tests mock `mergeAssMp4`，字段透传已验证；`video.test.ts` 19 tests 覆盖 cut/mergeAssMp4 路径
- [x] **范围**: 仅影响 `encoder !== "copy"` 路径；`copy` 模式走原分支，向后兼容

### B3: {{title}} 模板变量

- [x] **实现**: `TemplateContext.title` 字段 → `renderTitleTemplate`/`renderDescTemplate` 传递 → `uploadToBili` 从 `pasrseMetadata` 提取
- [x] **测试覆盖**: `templateRenderer.test.ts` 15 tests `applyTemplateVariables` 覆盖 vars 遍历；`title` 键在 map 中自动被 `replaceAll`
- [x] **范围**: 和录制系统 `webhook.ts formatTitle` 的 `{{title}}` 语义一致

### 范围蔓延检查

- [x] 无新增功能——三条修改严格对应三个 bug
- [x] 无架构级变更——未新增模块/包/中间件

**结论**: ✅ 三条 AC 全部实现，无范围蔓延。

---

## 第二轮 · 代码质量审查（6 维衰退风险）

> brooks-lint 未成功加载，走内置路径 B。每个诊断含 4 要素（Symptom / Source / Consequence / Remedy）+ 书本引用。

---

### 🟢 R1 · 认知过载：dailyUploadAids 意图清晰

**Symptom**: `service.ts:42` — `private dailyUploadAids = new Map<string, number>()` 变量名自解释，注释指明 key 格式。

**Source**: McConnell · Code Complete · "Variable Names Should Be Self-Documenting"

**Consequence**: 无。名字和注释已经让维护者一眼看懂这是"按 recorder+date 追踪每日投稿 AID"。

**Remedy**: 无需修改。✅

---

### 🟢 R2 · 变更传播：accurateSeek 隔离良好

**Symptom**: `video.ts:919-934` — accurateSeek 通过 `if (ffmpegOptions.accurateSeek && ...)` 独立分支，不触动原 `-copyts` 路径。`accurateSeek` 默认 `undefined` (falsy)，所有现有调用方行为不变。

**Source**: Fowler · Refactoring · "Divergent Change" — 用特性开关隔离新旧行为

**Consequence**: 无。autoclip 是唯一设置 `accurateSeek: true` 的调用方。其他 cut/mergeAssMp4 调用方不受影响。

**Remedy**: 无需修改。✅

---

### 🟡 R3 · 知识重复：TemplateContext.title 与录制系统的 {{title}} 语义重叠

**Symptom**: `templateRenderer.ts:9` `title: string` 和 `webhook.ts:53` `{{title}}` 都代表"直播标题"，但来源不同（autoclip 从 video metadata 提取，录制从 webhook payload 提取）。两个系统各自维护变量名→值的映射。

**Source**: Hunt & Thomas · Pragmatic Programmer · "Don't Repeat Yourself" — 同一概念（直播标题的模板变量）在两个模块分别定义

**Consequence**: 未来如果新增模板变量（如 `{{platform}}`），需要在两个系统分别添加，容易遗漏。中等风险。

**Remedy**: 考虑提取共享的 `TemplateVariableProvider` 接口，统一 `{{title}}` / `{{user}}` / `{{roomId}}` 等公共变量的定义。不阻塞本次合并，建议后续 refactor。

---

### 🟢 R4 · 偶然复杂：daily batching 实现简洁

**Symptom**: `service.ts:550-588` — 每日批量上传逻辑仅 ~40 行。`dateKey` 构造、`existingAid` 查找、`if/else` 分支清晰。

**Source**: Brooks · Mythical Man-Month · "Essential vs Accidental Complexity"

**Consequence**: 无。实现复杂度和问题匹配。

**Remedy**: 无需修改。✅

---

### 🟢 R5 · 依赖方向：uploadToBili 依赖 biliApi 方向正确

**Symptom**: `service.ts:407` — `const biliApi = (await import("../task/bili.js")).default` — Service 层依赖 Task 层（低层），方向正确。

**Source**: Martin · Clean Architecture · "Dependency Rule" — 高层策略依赖低层机制

**Consequence**: 无。依赖方向符合架构预期。

**Remedy**: 无需修改。✅

---

### 🟡 R6 · 领域扭曲：dailyUploadAids 是进程内状态，重启后丢失

**Symptom**: `service.ts:42` — `dailyUploadAids` 是 `Map<string, number>`（内存态）。如果 Electron 应用在两次上传之间重启，AID 丢失，同天后续切片会创建新投稿而非追加。

**Source**: Evans · Domain-Driven Design · "Model Integrity" — 聚合的持久化边界应与业务边界一致

**Consequence**: 低频场景（应用在上传间隔期重启）下，同天切片可能再次分散到多个投稿。体验降级但不丢数据。

**Remedy**: 两个改进方向（选一）：

1. **短中期**（推荐）：在 `dailyUploadAids` 初始化时从 DB 恢复——查询 `auto_clip_results` 表中当天 `bili_aids` 非空的记录，提取 AID 填入 Map
2. **长期**：新增 `daily_upload_tracker` 表持久化

不阻塞本次合并。🟡 Major，建议下次迭代修复。

---

### 🟢 R6 补充 · accurateSeek 与 addTimestamp 的不兼容已文档化

**Symptom**: `types/src/index.ts:1031-1035` — JSDoc 明确写了"与 addTimestamp 不兼容（时间戳会重置）"。autoclip 不使用 `addTimestamp`，无冲突。

**Source**: McConnell · Code Complete · "Self-Documenting Code"

**Consequence**: 无。不兼容性已显式声明，调用方不会误用。

**Remedy**: 无需修改。✅

---

## 第三轮 · UI 视觉审查

❌ 跳过。本次 change 不涉及 UI 文件（无 `.vue` / `.css` / `.html` 变更）。

---

## 第四轮 · 补充审查

### 4.1 技术债评估

❌ 跳过。非里程碑/季度大版本。`.specs/CONTEXT.md` `last_intel_scan` 为 2026-06-01（10 天前），未超 30 天阈值。

### 4.2 跨模型 spot-check

❌ 跳过。不命中触发条件：

- 不涉及安全/认证
- 不涉及并发/分布式（dailyUploadAids 是单进程内 Map，无并发竞争）
- 单函数均 < 80 行
- 测试覆盖率无下降（291 tests → 291 tests）

---

## 审查总结

### 严重度分布

| 严重度      | 数量 | 项目                                             |
| ----------- | ---- | ------------------------------------------------ |
| 🔴 Critical | 0    | —                                                |
| 🟡 Major    | 2    | R3 模板变量重复定义、R6 dailyUploadAids 重启丢失 |
| 🟢 Minor    | 4    | R1/R2/R4/R5 无问题                               |

### 阻塞项

无 🔴 Critical。本次 change 可以合并。

### 建议后续改进

1. **R6 (🟡 Major)**: `dailyUploadAids` 启动时从 DB 恢复（查询当日已上传记录的 AID）
2. **R3 (🟡 Major)**: 提取共享 `TemplateVariableProvider`，统一 autoclip 和录制系统的模板变量定义
