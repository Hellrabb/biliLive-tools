# REVIEW — autoclip-evidence-chain

> 日期：2026-06-02
> 审查范围：d1e5f1cc..4910ab1d（1 commit，59 files，+4237/-1010）

---

## 第一轮 · Spec 合规审查

### AC 覆盖矩阵

| AC                          | 实现                                                            | 测试                                   | 状态 |
| --------------------------- | --------------------------------------------------------------- | -------------------------------------- | ---- |
| AC-1 Pipeline 证据捕获      | `pipeline.ts:349-374` buildEvidence + 5 类数据收集              | `pipeline.test.ts`                     | ✅   |
| AC-2 证据 DB 持久化         | `service.ts:232,263` evidenceJson → upsertResult                | `service.test.ts`                      | ✅   |
| AC-3 Migration v6 幂等      | `db/autoClip.ts:144-146` ADD COLUMN + applied Set 检查          | `dbConstraint.test.ts`                 | ✅   |
| AC-4 HTTP API 返回 evidence | `routes/autoClip.ts:22-28,554,584` parseEvidenceSafe + GET 响应 | HTTP tests                             | ✅   |
| AC-5 API 容错               | `routes/autoClip.ts:22-28` parseEvidenceSafe try/catch          | 🟡 待补单元测试                        | 🟡   |
| AC-6 前端 EvidencePanel     | `EvidencePanel.vue` 完整 5 类证据渲染 + Canvas 密度图           | 手动 UAT                               | 🟡   |
| AC-7 无证据降级             | `EvidencePanel.vue` n-empty 三态（无选中/无证据/有证据）        | 手动 UAT                               | 🟡   |
| AC-8 构建回归               | CI                                                              | ✅ 910/916 tests pass, build:base 成功 | ✅   |

### 范围蔓延检查

- [x] 未新增 LLM provider
- [x] 未修改 autoclip preset 配置结构（evidence 自动捕获）
- [x] 未新增证据导出/搜索/对比功能
- [x] 未引入外部图表库（Canvas 自绘）
- [x] types.ts 的 Evidence 放在 autoClip 内部，未污染公共 types 包

### 架构越界检查

- [x] `AutoClipClipRow` 新增 `evidence?: Record<string, unknown> | null`（可选字段，向下兼容）
- [x] DB migration v6 使用既有 BaseModel 机制
- [x] 新文件 `evidence.ts`、`EvidencePanel.vue` 在声明的影响面内

**结论**：8 条 AC 中 5 条 ✅ + 3 条 🟡（AC-5 缺单元测试，AC-6/AC-7 需手动 UAT，但不阻塞 review 通过）。

---

## 第二轮 · 代码质量审查

### 2.0 TEST.md 完整性

- [x] 5 轮状态明确（1 ✅ + 3 ⚠️ + 1 ❌）
- [x] 跳过轮次均有理由
- [x] 第 1 轮每条 AC 有覆盖
- [x] 第 4 轮数据迁移验证完整
- [x] 第 2 轮 evidence 大小验证合理

**结论**：TEST.md 符合要求。✅

### 2.1 6 维衰退诊断（Path B：内置快查）

---

#### 🟢 R1 · Cognitive Overload：整体清晰，证据捕获散落可接受

**Symptom**：`pipeline.ts` 中证据数据收集（`evidenceDanmakuCurve`、`evidenceTriggerDanmaku`、`evidenceSignalDetails`）直接写在 `runAutoClipPipeline` 函数体内，与核心管道逻辑混在一起。但每个收集块 ≤10 行，命名清晰。

**Source**：McConnell · Code Complete · Chapter 7 — "High-quality routines should do one thing and do it well."

**Consequence**：若未来管线阶段增多（如加更多信号源），证据收集代码也随之膨胀。当前 3 个收集点可接受。

**Remedy**：暂不修。如果 pipeline 未来超过 400 行，考虑提取 `EvidenceCollector` 类。

---

#### 🟢 R2 · Change Propagation：变更隔离良好

**Symptom**：`signalDetector.detectDanmakuDensityPeaks` 返回值从 `TimeWindow[]` 改为 `{ windows, buckets }`。`refineBoundaries` 返回值从 `HighlightSegment[]` 改为 `{ highlights, refinements }`。两处 API 变更均已更新所有调用方。

**Source**：Fowler · Refactoring · Divergent Change — "One reason to change."

**Consequence**：仅 pipeline.ts 内部调用这两个函数，无外部调用方。测试已同步更新。无风险。

**Remedy**：无需修改。

---

#### 🟢 R3 · Knowledge Duplication：无概念级重复

**Symptom**：`buildEvidence` 是证据组装的单一入口。`parseEvidenceSafe` 是 JSON 解析的单一入口。无同一决策表达在多处的情况。

**Source**：Hunt & Thomas · The Pragmatic Programmer · DRY Principle.

**Remedy**：无需修改。

---

#### 🟢 R4 · Accidental Complexity：简洁适度

**Symptom**：`evidence.ts` 仅 40 行纯函数。`EvidencePanel.vue` ~280 行，Canvas 绘制逻辑 ≤80 行。DB migration v6 仅 3 行 SQL。整体复杂度与问题匹配。

**Source**：Ousterhout · A Philosophy of Software Design · Chapter 4 — "Modules should be deep."

**Remedy**：无需修改。

---

#### 🟢 R5 · Dependency Disorder：依赖方向正确

**Symptom**：检查依赖流：

- `pipeline.ts` → `evidence.ts`（同层，合理）
- `service.ts` → `autoClipModel`（业务 → DB 层）
- `routes/autoClip.ts` → `autoClipModel` + `service`（HTTP → 业务）
- `EvidencePanel.vue` → 纯展示组件，无数据依赖

无循环依赖，依赖方向一致。

**Source**：Martin · Clean Architecture · Chapter 22 — "Dependency Rule."

**Remedy**：无需修改。

---

#### 🟢 R6 · Domain Model Distortion：命名精准

**Symptom**：关键命名评估：

- `Evidence` — 精确对应"切片决策证据"概念
- `BoundaryRefinement` — 精确对应"边界精修前后对比"
- `buildEvidence` — 动词准确（构建证据）
- `parseEvidenceSafe` — 明确表达"安全解析"语义
- `densityBuckets` — 对应信号检测领域术语

**Source**：Evans · Domain-Driven Design · Chapter 2 — "Ubiquitous Language."

**Remedy**：无需修改。

---

### 2.2 架构依赖检查

**触发判定**：未新增顶级模块、无新中间件、无危险 import。不触发本段。

---

## 第三轮 · UI 视觉审查

### 3.1 Design Tokens 一致性

- [x] EvidencePanel 颜色通过 `getComputedStyle(canvas)` 读取 CSS 变量（`--color-primary`、`--color-warning`、`--border-primary`、`--text-muted`）
- [x] 模板中直接引用了现有 CSS 变量（`var(--bg-secondary)`、`var(--text-muted)`、`var(--color-primary)`、`var(--border-primary)`）
- [x] Canvas 降级色值（`|| "#18a058"` 等）为 Naive UI 绿色主题的默认值，与 `styles.less` 一致

### 3.2 Anti-Pattern 扫描

逐项对照 UI-DESIGN.md § 7 的强制禁忌：

- [x] 字体：无自定义字体，沿用系统栈 → 不命中 Inter/Roboto/Arial 禁忌
- [x] 颜色：无硬编码纯黑纯白、无紫色渐变、无彩底灰字
- [x] 阴影：at rest 平面（n-card 默认无 shadow）
- [x] 边框：选中左边框 3px 为功能性指示（非装饰性彩条）
- [x] 动效：无 bounce/elastic；不触发 layout 属性动画
- [x] 布局：无卡片嵌套（EvidencePanel 内 n-card 为并列子区）
- [x] 文案：无 hedging、无 lorem ipsum；按钮动词中文简洁
- [x] 组件：n-empty 充当状态占位（非 label 替代）；无模态需求

**0 项命中 AI-slop 禁忌。✅**

### 3.3 视觉北极星一致性

UI-DESIGN.md 声明调性为"工程工具型——功能优先，信息密度中等"。EvidencePanel 实现了：

- n-card 分区清晰（密度图 → 信号详情 → 精修对比 → 评分 → 弹幕）
- Canvas 密度图简洁直接，品牌绿色柱状图
- 无多余装饰元素

与声明的工程工具调性一致。✅

---

## 第四轮 · 补充审查

### 4.1 技术债评估

未命中触发条件。非里程碑/大版本/重构项目。

### 4.2 跨模型 spot-check

未命中触发条件。无安全/认证变更、无并发/分布式变更。

---

## 审查结论

| 轮次               | 结果    | 发现                                             |
| ------------------ | ------- | ------------------------------------------------ |
| 第一轮 · Spec 合规 | ✅ 通过 | 3 个 🟡（AC-5 缺单元测试，AC-6/AC-7 待手动 UAT） |
| 第二轮 · 代码质量  | ✅ 通过 | 0 个 Critical，0 个 Major                        |
| 第三轮 · UI        | ✅ 通过 | 0 项 AI-slop 命中                                |
| 第四轮 · 补充      | ⏭️ 跳过 | 均未命中触发条件                                 |

### 🟡 Minor 问题

| 编号        | 描述                               | 建议                                                            |
| ----------- | ---------------------------------- | --------------------------------------------------------------- |
| AC5-TEST-01 | `parseEvidenceSafe` 无独立单元测试 | 补 `parseEvidenceSafe` 单元测试（损坏 JSON / null / 有效 JSON） |
| AC6-UAT-01  | EvidencePanel 渲染需手动 UAT 验证  | 启动 Electron app，选中含 evidence 的切片行，验证 5 类证据渲染  |
| AC7-UAT-02  | 无证据降级需手动 UAT               | 选中旧切片数据，验证 n-empty 降级展示                           |

### 🔴 Critical 问题

无。

---

## 最终判定

**✅ 通过。0 个 Critical，3 个 Minor。**

可直接进入 INTEGRATION（7-integration）。Minor 项（AC-5 单元测试补全 + 手动 UAT）可在 integration 阶段或后续迭代中完成。
