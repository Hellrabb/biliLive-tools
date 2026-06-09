# REVIEW: AutoClip FFmpeg 预设参数预览

- **Change ID**: autoclip-ffmpeg-custom
- **关联**: `@.specs/autoclip-ffmpeg-custom/REQUIREMENT.md`、`@.specs/autoclip-ffmpeg-custom/DESIGN.md`、`@.specs/autoclip-ffmpeg-custom/UI-DESIGN.md`、`@.specs/autoclip-ffmpeg-custom/TASK.md`、`@.specs/autoclip-ffmpeg-custom/TEST.md`
- **审查文件**: `AutoClipPresetDialog.vue` (+136 lines), `Home/index.vue` (+18 lines)

---

## 第一轮 · Spec 合规审查

### AC 逐条覆盖

| AC   | 描述                              | 实现状态                                                   | 测试覆盖 |
| ---- | --------------------------------- | ---------------------------------------------------------- | -------- |
| AC-1 | 自定义预设出现在下拉中            | ✅ `loadFfmpegPresets()` 调用 `options()` 返回自定义预设组 | UAT-1    |
| AC-2 | 下拉展示内置 + 自定义预设（分组） | ✅ API 返回分组数据，映射 `type: 'group'`                  | UAT-2    |
| AC-3 | 选中预设后参数预览（只读）        | ✅ `<n-descriptions>` 展示 6 项参数                        | UAT-3    |
| AC-4 | 选中预设后 encoder 自动同步       | ✅ `watch(selectedPresetConfig, ...)` 单向同步             | UAT-4    |
| AC-5 | 跳转链接可操作                    | ✅ `router.push` + 内置预设文本提示                        | UAT-5    |
| AC-6 | 加载失败时不再静默吞错            | ✅ `notice.error(...)`                                     | UAT-6    |

### 范围蔓延检查

- [x] 未引入"在对话框内编辑预设参数"（v2 范围）
- [x] 未改动 `exportPipeline.ts` 后端管线（out 范围）
- [x] 未新增 FFmpeg 预设 CRUD API（out 范围）
- [x] 未移除 `encoder` 字段（out 范围）

### 额外发现

- ✅ `biliUpTemplate` 空值守卫（line 327-329）：本次顺便修复了 AC 之外的一个预发 typecheck 错误，属于防御性修补，不构成范围蔓延

**第一轮结论：🟢 PASS — 6/6 AC 全部实现，无范围蔓延。**

---

## 第二轮 · 代码质量审查（6 维衰退风险）

### 2.0 TEST.md 金字塔完整性

- [x] 5 轮状态明确 ✅
- [x] 跳过轮次有理由 ✅
- [x] 第 1 轮每条 AC 有覆盖 ✅
- [x] 第 2/3/4/5 轮对应填写 ✅

**结论：TEST.md 完整，无阻塞。**

### 2.1 6 维诊断

#### 🟢 R1 · Cognitive Overload 认知过载：可接受

**Symptom**: `getPresetLabel()` 函数（AutoClipPresetDialog.vue:756-766）使用 if-else 链匹配 encoder 前缀，每个分支返回不同枚举常量。  
**Source**: McConnell · Code Complete · Ch.19 "General Control Issues" — if-else 链在分支 ≤ 7 时可读；《重构》Ch.3 指出超过 5 个条件 → 考虑用查找表替代。  
**Consequence**: 当前 6 个分支，刚好在阈值边缘。如果后续新增编码器类型（如 `vaapi`），此函数会膨胀。  
**Remedy**: 当前不修。6 分支仍可读，且有单元行为正确性。建议未来用 keyed lookup 重构：

```ts
const PRESET_MAP: Record<string, { value: string; label: string }[]> = {
  nvenc: nvencPresets,
  av1_nvenc: nvencPresets,
  qsv: qsvPresets,
  amf: amfPresets,
  av1_amf: amfAv1Presets,
  videotoolbox: videoToolBoxPresets,
};
```

→ 记入 LESSONS，下次改 encoder 枚举时顺手重构。**不阻塞**。

#### 🟢 R2 · Change Propagation 变更传播：可控

**Symptom**: `loadFfmpegPresets()` 的数据映射逻辑（line 732-742）将 API 返回的 `{value, label, children}` 结构转换为 Naive UI 的 `{type:'group', label, key, children}` 格式。  
**Source**: Feathers · Working Effectively with Legacy Code · Ch.8 "How Do I Add a Feature?" — 数据适配逻辑应集中在单一转换层。  
**Consequence**: 如果 API 返回格式变化，只需改 `loadFfmpegPresets()` 一处。当前设计良好——转换逻辑未分散。  
**Remedy**: 无。当前设计符合"单一适配点"原则。

#### 🟢 R3 · Knowledge Duplication 知识重复：无

**Symptom**: 无概念级重复。`encoder` 同步逻辑（watch + selectedPresetConfig）只在 watch 中表达一次；preset label 映射只在 `getPresetLabel` 中表达一次。  
**Consequence**: N/A。  
**Remedy**: 无。

#### 🟡 R4 · Accidental Complexity 偶然复杂：Minor

**Symptom**: `selectedPresetConfig` computed（line 748-754）通过遍历 `ffmpegPresetOptions` 的 group children 查找匹配 config。当选中预设后，T03 模板中多次访问 `selectedPresetConfig.xxx`，每次触发完整的遍历查找。  
**Source**: Fowler · Refactoring · Ch.9 "Simplifying Conditional Expressions" + Brooks · Mythical Man-Month · "Accidental vs Essential Complexity"。  
**Consequence**: `ffmpegPresetOptions` 数据量小（<50 项），性能无影响。但代码表达了"每次渲染都 O(n) 查找"的意图，虽然实际无碍。  
**Remedy**: 不修。数据量太小（<50 项），优化无实际收益。但记入 LESSONS：如果未来预设数量突破 200+ 或该 computed 在热路径上被频繁调用，应改为 `Map<id, config>` 索引。

#### 🟢 R5 · Dependency Disorder 依赖混乱：无

**Symptom**: 本次所有新增代码均在 Vue 组件层（表现层），依赖方向正确：

- `AutoClipPresetDialog.vue` → `@renderer/apis/presets`（API 层）
- `Home/index.vue` → `vue-router`（框架层）
- 无反向依赖。  
  **Source**: Martin · Clean Architecture · Ch.22 "The Clean Architecture" — 依赖应指向稳定的抽象。  
  **Consequence**: N/A。  
  **Remedy**: 无。

#### 🟢 R6 · Domain Model Distortion 领域扭曲：无

**Symptom**: 新增代码正确使用既有领域概念：`ffmpegPreset`、`encoder`、`config`、`export`，未引入新术语。参数预览展示的字段（bitrateControl, crf, bit10）与既有 FFmpegPreset config 模型一致。  
**Source**: Evans · DDD · Ch.9 "Making Implicit Concepts Explicit"。  
**Consequence**: N/A。  
**Remedy**: 无。

### 2.2 架构依赖检查

本次改动不触发架构依赖检查条件（未新增模块、无跨模块依赖、无新增中间件）。

**第二轮结论：🟢 PASS — 1 个 🟡 Minor（R4 偶然复杂），其余全部 🟢。无 Critical。**

---

## 第三轮 · UI 视觉审查（前端项目）

### 3.1 Design Tokens 一致性

- [x] 所有颜色来自 Naive UI 默认 token + 既有 `styles.less` —— 无硬编码 hex ✅
- [x] 字体沿用 Naive UI `v-sans` 默认字体栈 —— 无新字体 ✅
- [x] 间距：`margin-bottom: 16px`（合理，在 Naive UI 设计体系内）✅
- [x] 无硬编码 `font-size` / `border-radius` / `box-shadow` ✅

### 3.2 Anti-Pattern 扫描（逐项对照 `ui-anti-patterns.md`）

| 类别   | 命中？    | 说明                                                            |
| ------ | --------- | --------------------------------------------------------------- |
| 字体类 | ❌ 未命中 | 100% 沿用 Naive UI 默认字体                                     |
| 颜色类 | ❌ 未命中 | 无纯黑/纯白；`n-text depth="3"` 用 Naive UI 灰色 token          |
| 阴影类 | ❌ 未命中 | 不新增阴影                                                      |
| 边框类 | ❌ 未命中 | `n-descriptions bordered` 用 Naive UI 默认细边框                |
| 动效类 | ❌ 未命中 | 不新增动画                                                      |
| 布局类 | ❌ 未命中 | 不涉及卡片嵌套/SaaS hero                                        |
| 文案类 | ❌ 未命中 | 工程向中文："编辑此预设 →"、"内置预设 · 在预设管理中复制后编辑" |
| 组件类 | ❌ 未命中 | `n-descriptions` 正常使用 label，不靠 placeholder 替代          |

### 3.3 视觉北极星一致性

UI-DESIGN §1 声明的北极星："Naive UI 工程工具风 —— 绿色品牌 + 浅灰中性 + 组件库原生 token。功能优先，视觉由框架约束"。

**判断**：✅ 一致。`n-descriptions bordered` 的参数预览卡片与 AutoClipManagement/Index.vue 已有模式完全一致，无任何"出戏"的视觉元素。

### 3.4 无障碍快检

- [x] 颜色对比：Naive UI 默认 token 已满足 WCAG 2.1 AA（组件库测试覆盖）✅
- [x] 键盘可达：`n-select` / `n-button` 原生支持 Tab ✅
- [x] 焦点环：Naive UI 默认 focus ring，与组件库整体一致 ✅
- [x] `prefers-reduced-motion`：不新增动画 ✅
- [x] 表单 label：`n-form-item label="xxx"` 显式关联 ✅

**第三轮结论：🟢 PASS — 零 anti-pattern 命中，视觉一致。**

---

## 第四轮 · 补充审查

### 4.1 技术债评估

未命中触发条件（非里程碑/季度版本/重构项目）→ 跳过。

### 4.2 跨模型 spot-check

未命中触发条件（无安全/并发/分布式变更；最大单函数 < 30 行）→ 跳过。

---

## 审查总结

| 轮次               | 结论    | Critical | Major | Minor  |
| ------------------ | ------- | -------- | ----- | ------ |
| 第一轮 · Spec 合规 | 🟢 PASS | 0        | 0     | 0      |
| 第二轮 · 代码质量  | 🟢 PASS | 0        | 0     | 1 (R4) |
| 第三轮 · UI 视觉   | 🟢 PASS | 0        | 0     | 0      |
| 第四轮 · 补充      | 跳过    | —        | —     | —      |

**总评：🟢 无 Critical 阻塞。1 个 🟡 Minor（R4 偶然复杂）建议未来用 `Map` 索引优化，当前数据量 < 50 项无实际性能影响，记入 LESSONS。**

无需生成 fix 任务。直接进入 7-integration。
