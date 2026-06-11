# REVIEW: autoclip B站上传改为同一稿件分P

- **Change ID**: `autoclip-bili-part-upload`
- **审查日期**: 2026-06-11
- **审查者**: AI（brooks-review 内置回退路径）

---

## 第一轮 · Spec 合规审查

| AC                                                        | 状态 | 证据                                                                                                              |
| --------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------- |
| AC-1 多切片聚合为单稿件多P                                | ✅   | `videos = exportedResults.map(...)` → 单次 `addMedia(videos, ...)`，57 insertions 替换 45 deletions，核心循环消除 |
| AC-2 稿件主标题用 titleTemplate                           | ✅   | `firstHighlightTitle` 取自 `exportedResults[0]`，`renderTitleTemplate(titleTemplate, ctx)` 渲染主标题             |
| AC-3 分P标题默认 highlight.title + partTitleTemplate 回退 | ✅   | `partTitleTemplate ? renderTitleTemplate(...) : hlTitle`，回退链完整                                              |
| AC-4 封面用第一个切片自动截帧                             | ✅   | 封面截帧从循环内移出，仅取 `firstResult`；手动 `coverPath` 优先级不变                                             |
| AC-5 单切片降级单P                                        | ✅   | `exportedResults[0]!` 安全——调用方 L352 已检查 `success.length > 0`                                               |
| 范围蔓延检查                                              | ✅   | 无 UI 变更、无手动导出路径变更、无新增配置项                                                                      |
| 禁动清单检查                                              | ✅   | 未触碰 pipeline.ts / video.ts / routes/autoClip.ts                                                                |

**第一轮结论：5/5 AC 满足，无范围蔓延。通过。** ✅

---

## 第二轮 · 代码质量审查（6 维衰退风险诊断）

b/l CLI 可用性：skill loaded，无 npm binary。走内置路径。

---

### 🟢 R1 · Cognitive Overload 认知过载：结构改善，无过载

**Symptom**：`uploadToBili` 方法从「循环内混合标题+封面+上传」重构为三段式结构（主标题 → 封面 → 分P数组+上传）。

**Source**：McConnell · Code Complete · §5.2 "High-quality routines should do one thing well"

**Consequence**：原结构在循环内处理三种不同关注点（标题渲染、封面截帧、addMedia），修改任一项都需理解整个循环。新结构按关注点分离，标题/封面/分P数组各自独立，每段职责单一。

**Remedy**：无需修改。当前结构已优于原代码。

---

### 🟢 R2 · Change Propagation 变更传播：隔离良好

**Symptom**：移除 `partTitleTemplate` 从 `optionalOverrides` 中（L435），改为在 autoclip 层自行渲染。此字段原会透传至 `addMedia` → `preFormatOptions` → `formatPartTitle`（bili.ts L614-656），使用视频元数据变量渲染分P标题——与 autoclip 的高光片段领域不兼容。

**Source**：Fowler · Refactoring · "Shotgun Surgery" — 一个变更需改多处，或一个字段影响多个不相干的子系统。

**Consequence**：移除后，`addMedia` 的 `preFormatOptions` 不再尝试用录制视频元数据格式化 autoclip 的分P标题。消除了隐式的领域混淆。未来若 `addMedia` 的 `partTitleTemplate` 行为变更，autoclip 不受影响。

**Remedy**：无需修改。变动隔离正确。

---

### 🟢 R3 · Knowledge Duplication 知识重复：轻微微复制

**Symptom**：`highlight?.title || path.parse(expPath).name` 回退逻辑出现两次：

- `service.ts:468` — `firstHighlightTitle`（主标题用）
- `service.ts:501` — `hlTitle`（分P标题用）

**Source**：Hunt & Thomas · Pragmatic Programmer · "DRY — Every piece of knowledge must have a single, unambiguous representation"

**Consequence**：如果未来高光标题的回退逻辑变更（例如新增 `highlight.reason` 作为第三回退），需改两处。但当前两处语义不同（一个是主标题、一个是分P标题），强行合并为一个 helper 可能降低可读性。

**Remedy**：暂不修复。两处使用场景不同（主标题 vs 分P），且回退逻辑仅 1 行。若未来回退链变复杂（>2 层），再提取为 `getHighlightTitle(h: HighlightSegment, p: string): string`。

---

### 🟢 R4 · Accidental Complexity 偶然复杂：无

**Symptom**：diff 新增代码 57 行、删除 45 行，净增 12 行。循环消除 + 聚合模式比原逐次 addMedia 更简洁。

**Source**：Brooks · Mythical Man-Month · "Accidental vs Essential Complexity"

**Consequence**：新增的 `.map()` 中 `{ ...ctx, highlightTitle: hlTitle }` 每迭代创建新对象（L503），但 ctx 仅 4 个键，性能影响可忽略。

**Remedy**：无需修改。

---

### 🟢 R5 · Dependency Disorder 依赖混乱：无

**Symptom**：依赖关系无变化。`uploadToBili` → `biliApi.addMedia`、`sampleFrames`、`renderTitleTemplate` 流向不变。

**Source**：Martin · Clean Architecture · §14 "Dependency Rule — dependencies point inward toward higher-level policy"

**Consequence**：无循环依赖、无跨层反向依赖。

**Remedy**：无需修改。

---

### 🟢 R6 · Domain Model Distortion 领域扭曲：修复了既有扭曲

**Symptom**：原代码将 `partTitleTemplate` 放入 `optionalOverrides`（L435），透传给 `addMedia`（bili.ts L672）→ `preFormatOptions`（bili.ts L515）→ `formatPartTitle`（bili.ts L635-645），使用录制视频元数据变量（`{{filename}}`、`{{title}}`（视频标题）、`{{index}}`）渲染分P标题。但 autoclip 的高光片段**没有视频元数据**（highlight.title ≠ 视频标题），所以 `formatPartTitle` 的渲染结果实际上不可控。

**Source**：Evans · DDD · §9 "Making implicit concepts explicit" — 当两个上下文共享同一个概念（分P标题）但语义不同时，必须显式建模

**Consequence**：修复后，分P标题渲染完全在 autoclip 域内完成（L499-506），使用 autoclip 自己的变量集（`{{highlightTitle}}`、`{{roomName}}` 等）。领域边界清晰。

**Remedy**：无需修改。这是本次 change 的核心价值之一。

---

## 第三轮 · UI 视觉审查

**跳过**。纯后端变更，不涉及任何 UI 文件。

---

## 第四轮 · 补充审查

- **4.1 技术债评估**：跳过。本 change 为 small 单任务变更，非里程碑/大版本。CONTEXT.md 技术债段在 90 天内更新过。
- **4.2 跨模型 spot-check**：跳过。无安全/并发/分布式代码，无 >80 行函数。

---

## 审查结论

| 轮次              | 结果                                    |
| ----------------- | --------------------------------------- |
| 第一轮 · Spec     | ✅ 通过（5/5 AC）                       |
| 第二轮 · 代码质量 | ✅ 通过（6 维均 🟢，无 Critical/Major） |
| 第三轮 · UI       | ⏭️ 跳过（纯后端）                       |
| 第四轮 · 补充     | ⏭️ 跳过（未命中触发条件）               |

**总评**：无 Critical 或 Major 发现。代码质量改善——消除领域扭曲（R6）、降低变更传播（R2）、提升结构清晰度（R1）。可以进入集成阶段。

---

> 审查基于 git diff：`packages/shared/src/autoClip/service.ts`，57 insertions / 45 deletions。
