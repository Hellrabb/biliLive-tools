# REVIEW · autoclip-upload-template-ui

> 日期：2026-06-08
> 审查范围：5 commits，6 files，+301/-25

---

## 第一轮 · Spec 合规审查

| AC                | 状态 | 实现位置                                                   | 测试         |
| ----------------- | ---- | ---------------------------------------------------------- | ------------ |
| AC-1 表单显隐     | ✅   | `AutoClipPresetDialog.vue:273` `v-if="...uploadToBili"`    | UAT-1        |
| AC-2 标题模板变量 | ✅   | `templateRenderer.ts:43` `renderTitleTemplate()`           | 6 unit tests |
| AC-3 简介模板变量 | ✅   | `templateRenderer.ts:56` `renderDescTemplate()`            | 2 unit tests |
| AC-4 默认值       | ✅   | `autoClipPreset.ts:48` + `selectPreset` guard (line 685)   | tsc 验证     |
| AC-5 上传链路     | ✅   | `service.ts:399` `uploadToBili()` 新逻辑                   | tsc 验证     |
| AC-6 向后兼容     | ✅   | `selectPreset` guard (line 685-697)                        | tsc 验证     |
| AC-7 分区列表     | ✅   | `localStorage areaData` + `n-cascader` (line 308)          | UAT-2        |
| AC-8 封面自动提取 | ✅   | `service.ts:446-467` `sampleFrames()` + bestRange midpoint | tsc 验证     |

### 范围蔓延检查

- ❌ 未引入 `out of scope` 的内容
- ❌ 未新增 REQUIREMENT.md 之外的功能
- ⚠️ `AutoClipPresetDialog.vue` diff 中包含 ffmpeg 预设下拉改造（`n-input`→`n-select` + `loadFfmpegPresets`），这是**已有的未提交改动**混合在 diff 中，与本 change 无关但无冲突

---

## 第二轮 · 代码质量审查（6 维衰退）

### 2.0 TEST.md 5 轮完整性

- ✅ 5 轮状态明确
- ✅ 跳过轮次有理由
- ✅ 第 1 轮每条 AC 有覆盖（8/8）
- ✅ 第 3 轮 pnpm audit 已跑（160 漏洞，全为既有）

### 2.1 6 维衰退诊断

#### 🟢 R1 · 认知过载：全部通过

- `templateRenderer.ts`: 3 个导出函数，各 < 20 行，JSDoc 完整。无嵌套 > 2 层。
- `service.ts uploadToBili()`: ~60 行但有清晰的逻辑分段（context → config → loop → cover）。可接受。
- `AutoClipPresetDialog.vue`: 新增 ~80 行声明式 Vue 模板，8 个 `n-form-item` 结构一致，可读性好。

#### ✅ R2 · 变更传播：全部通过

- `BiliUpTemplateConfig` 是新增导出类型，不破坏已有接口
- `AutoClipExportConfig.biliUpTemplate` 是可选字段，旧代码无需改动
- `uploadToBili()` 是 private 方法，签名变更不影响外部调用者
- 禁动清单中的文件（`videoPreset.ts` / `bili.ts` / `index.ts`）未被修改 ✅

#### 🟡 R3 · 知识重复：1 项 Minor

**Symptom**: `renderTitleTemplate` 和 `renderDescTemplate` 中变量映射重复（4 个相同字段）。

**Source**: Hunt & Thomas · Pragmatic Programmer · DRY 原则

**Consequence**: 如果新增变量，需在两处同步修改。当前变量集稳定，风险低。

**Remedy**: 抽取 `const TEMPLATE_VARS = ['highlightTitle', 'roomName', 'date', 'uploadDate']` 或合并两个函数为 `renderTemplate(template, ctx, maxLen?)`。优先级：低——可在下次重构时处理。

#### ✅ R4 · 偶然复杂：全部通过

- 模板引擎：`replaceAll` 是最简实现，未引入 ejs/handlebars
- 封面提取：15 行自包含逻辑，try/catch 降级
- 类型设计：`BiliUpTemplateConfig` 直接嵌入而非建立独立预设系统

#### ✅ R5 · 依赖混乱：全部通过

- `templateRenderer.ts` → 纯工具文件，无外部依赖
- `service.ts` → 沿用既有的 import 路径（`./frameSampler.js` / `../presets/videoPreset.js` / `../task/bili.js`）
- `AutoClipPresetDialog.vue` → 沿用既有组件路径（`./DynamicTags.vue`）
- 无反向依赖，无跨层 import

#### ✅ R6 · 领域扭曲：全部通过

- `BiliUpTemplateConfig` 字段名与 B站业务对齐：`tid` / `copyright` / `source` / `noReprint`
- `TemplateContext` 变量名直观：`highlightTitle` / `roomName` / `date` / `uploadDate`
- UI label 使用中文业务术语：标题模板 / 投稿分区 / 自制/转载 / 禁止转载

---

## 第三轮 · UI 视觉审查

### 3.1 Design Tokens 一致性

- ✅ 无硬编码颜色（所有颜色由 Naive UI 控制）
- ✅ 无硬编码字号（仅 feedback 使用 `font-size: 12px` ——与既有模式一致）
- ✅ 字体由 Naive UI 控制，未引入新字体

### 3.2 Anti-Pattern 扫描

逐项对照既有模式（`AutoClipPresetDialog.vue` 现有样式）：

| 检查项                    | 结果                          |
| ------------------------- | ----------------------------- |
| 字体类（无 AI slop 默认） | ✅ Naive UI 默认              |
| 颜色类（无纯黑/纯白）     | ✅ 继承 Naive UI 主题         |
| 阴影类                    | ✅ 无自定义阴影               |
| 边框类                    | ✅ 无彩色侧条                 |
| 动效类                    | ✅ 无自定义动效               |
| 布局类（无卡片嵌套）      | ✅ n-form-item 标准表单布局   |
| 文案类                    | ✅ 中文标签，动词具体         |
| 组件类                    | ✅ n-form-item label 显式关联 |

### 3.3 视觉北极星一致性

工具型桌面应用 settings 风格：功能直白、中文标签、提示到位。实现完全符合。

### 3.4 无障碍快检

- ✅ 表单 label 显式关联（n-form-item label 属性）
- ✅ 焦点环继承 Naive UI 默认
- ⚠️ 颜色对比未实测（Naive UI 默认主题一般通过 AA，需浏览器 DevTools 确认）
- N/A 无图片 alt 需求，无 `prefers-reduced-motion` 自定义

---

## 第四轮 · 补充审查

### 4.1 技术债评估

未触发（非里程碑版本，CONTEXT.md 技术债段 1 周前更新）。

### 4.2 跨模型 spot-check

未触发（无超 80 行单体函数，无安全/并发敏感逻辑）。

---

## 总结

| 轮次             | 结果           | Critical | Major | Minor               |
| ---------------- | -------------- | -------- | ----- | ------------------- |
| 第一轮 Spec 合规 | ✅ 8/8 AC 实现 | 0        | 0     | 0                   |
| 第二轮 代码质量  | ✅ 通过        | 0        | 0     | 1 (R3 变量映射重复) |
| 第三轮 UI 审查   | ✅ 通过        | 0        | 0     | 0                   |
| 第四轮 补充      | 未触发         | —        | —     | —                   |

**结论：✅ 无 Critical/Major 缺陷。1 项 Minor（R3 变量映射重复）可在后续重构处理。可以进入集成。**
