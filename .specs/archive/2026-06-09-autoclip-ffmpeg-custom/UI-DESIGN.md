# UI Design: AutoClip FFmpeg 预设参数预览

- **Change ID**: autoclip-ffmpeg-custom
- **关联**: `@.specs/autoclip-ffmpeg-custom/DESIGN.md`、`@.specs/CONTEXT.md`

---

## 0. 视觉语汇对齐（brownfield）

### 0.1 观察报告（代码为源）

- **Token 源**：`packages/app/src/renderer/src/assets/css/styles.less`，`:root` 上定义 `--color-*` / `--bg-*` / `--text-*` / `--border-*`
- **组件库**：Naive UI 2.44，`n-config-provider` 使用 `lightTheme`/`darkTheme`（pinia theme store），无自定义 `themeOverrides`
- **主色**：`--color-primary #18a058`（绿），占比 ~3%，只在 primary button、链接、选中态使用
- **中性色**：bg 白 `#fff` → 浅灰 `#f9fafb` → `#f8f9fa`；文字 `#000` → `#333` → `#555` → `#999`
- **hover / focus**：统一由 Naive UI 组件内部接管，项目不自定义
- **动效语言**：全部由 Naive UI 组件内部处理，项目不自定义 `cubic-bezier` / `@keyframes`
- **elevation**：Naive UI 默认阴影层级，项目不自定义 `box-shadow`
- **图标**：`@vicons/ionicons5` + `@vicons/material` + `@vicons/fluent`
- **文案调性**：工程向中文，动词为主（"选择FFmpeg预设"/"留空自动提取封面"），按钮写"确认"/"取消"
- **表单模式**：`<n-form-item label="xxx">` 垂直排列，`<n-select>` 用 `filterable`+`clearable`，width 200-220px
- **n-descriptions 模式**（已有先例）：`label-placement="left"`，`:column="2"`，`size="small"`（AutoClipManagement/Index.vue:140-156）

### 0.2 用户校准结论

- ✅ 用户确认观察正确，v0 草稿通过

### 0.3 应用策略

- **沿用**：Naive UI 全部默认 token（颜色/字体/间距/圆角/动效/阴影），不引入任何新 CSS 变量
- **延伸**：`n-descriptions` 从已有的 `:column="2"` 延伸为本次的 `:column="1"`（单列 key-value 更适合参数预览）
- **打破**：无

---

## 1. 美学北极星

Naive UI 工程工具风 —— 绿色品牌 + 浅灰中性 + 组件库原生 token。功能优先，视觉由框架约束，不追求装饰性表达。

### v0 确认摸路

- **已确认的假设**：
  - 参数预览用 `<n-descriptions label-placement="left" :column="1" size="small">`
  - 分组下拉在 `options()` API 返回数据后前端注入 `type: 'group'`
  - 跳转链接用 `<n-button text type="info">` 渲染
  - 不新增任何 CSS token
- **用户指出的偏差**：无

---

## 2. 4 个决策问题

- **目的**：AutoClip 导出设置中，帮助用户快速确认选中的 FFmpeg 预设参数，避免选错编码配置
- **调性**：工程工具——沿用 Naive UI 原生风格，信息密度适中，无装饰
- **约束**：不引入新依赖；不改动 Naive UI 默认 theme；所有视觉 token 从既有 `styles.less` + Naive UI 继承
- **差异化**：N/A（不是面向终端消费者的产品，差异化由功能决定）

---

## 3. 颜色系统

**100% 沿用既有**。不新增任何颜色。本次涉及的颜色语义：

| 用途              | Token                                                    | 说明                  |
| ----------------- | -------------------------------------------------------- | --------------------- |
| 参数预览标签文字  | Naive UI default（继承 `n-descriptions`）                | 不覆盖                |
| 参数预览值文字    | Naive UI default                                         | 不覆盖                |
| "编辑此预设" 链接 | `--color-info: #1890ff` 或 `<n-button text type="info">` | 沿用 Naive UI info 色 |
| 内置预设提示文本  | `--text-muted: #666`                                     | 沿用                  |

---

## 4. 字体系统

**100% 沿用** Naive UI 默认字体栈（`v-sans`：`"PingFang SC", "Microsoft YaHei", ...`）。本次不涉及任何字体选择。

---

## 5. 间距 & 圆角 & 动效

**100% 沿用** Naive UI 默认 token。本次新增元素的间距规则：

- 参数预览卡片：`margin-top: 8px`（与上方 n-select 的间距），内部由 `n-descriptions` 管理
- 链接与预览的间距：`n-descriptions` 尾部追加 `<n-button text>`，自然流内间距

---

## 6. 关键组件规约

### 参数预览卡片（本次新增）

- **实现**：`<n-descriptions label-placement="left" :column="1" size="small" bordered>`
- **参照**：AutoClipManagement/Index.vue 已有 `n-descriptions` 模式
- **at rest**：`bordered` 细线边框（Naive UI 默认），浅灰背景
- **行**：6 行（编码器/码率控制/码率/Preset/CRF/10-bit）
- **底部追加**：链接行 —— 自定义预设显示 `<n-button text type="info" @click="navigateToFfmpegSettings">编辑此预设 →</n-button>`；内置预设显示 `<n-text depth="3">内置预设 · 在预设管理中复制后编辑</n-text>`

### FFmpeg 预设下拉（改动点）

- **实现**：`<n-select>` + 动态注入 `type: 'group'`
- **行为**：与已有 `<n-select>` 完全一致（`filterable`、`clearable`），仅 options 数据结构变化
- **选中后触发**：encoder 同步 + 参数预览渲染

### 导航链接

- **自定义预设**：`<n-button text type="info">编辑此预设 →</n-button>`，点击调用 `router.push({ path: '/home', query: { tab: 'ffmpeg-setting' } })`
- **内置预设**：`<n-text depth="3">内置预设 · 在预设管理中复制后编辑</n-text>`，不可点击

---

## 7. Do's and Don'ts

### Do

- 用 `<n-descriptions>` 渲染参数预览（与 AutoClipManagement 已有模式一致）
- 用 `<n-button text type="info">` 渲染跳转链接
- 预设分组数据注入 `type: 'group'` 后直接传给 `<n-select>`

### Don't

- 禁止给参数预览卡片加自定义阴影、圆角、渐变背景——保持 Naive UI 原生
- 禁止用裸 `<a>` 标签或 `window.open` 跳转——用 `router.push`
- 禁止在 AutoClipPresetDialog 内写内联 FFmpeg 编辑表单——跳转到设置页

---

## 8. 占位符策略

| 缺的东西          | 本项目有什么                                              | 缺时用什么                              | 禁什么         |
| ----------------- | --------------------------------------------------------- | --------------------------------------- | -------------- |
| 图标              | `@vicons/ionicons5`、`@vicons/material`、`@vicons/fluent` | Naive UI 内置 icon 或 `[待定图标]` 文本 | emoji 凑       |
| 预设参数值        | 从 API 返回的 `config` 对象提取                           | 显示原始值，不编造                      | 编造默认值     |
| preset label 映射 | `nvencPresets` 等枚举常量                                 | 匹配不到时显示原始值（如 `p3`）         | 硬编码中文映射 |

---

## 9. 反 AI-slop 自检结果

逐条对照 `ui-anti-patterns.md` 强制禁忌：

- [x] 字体类：未命中（沿用 Naive UI 默认字体栈，不涉及字体选择）
- [x] 颜色类：未命中（不引入新颜色，不涉及纯黑/纯白/紫色渐变/渐变文字）
- [x] 阴影类：未命中（不新增阴影，参数预览用 Naive UI 默认 bordered 样式）
- [x] 边框类：未命中（不涉及彩色侧条/渐变边框/玻璃拟态）
- [x] 动效类：未命中（不新增动画，全部由 Naive UI 组件内部处理）
- [x] 布局类：未命中（不涉及卡片网格/hero/skeleton/dark mode）
- [x] 文案类：未命中（用工程向中文，动词为主）
- [x] 组件类：未命中（不新增 button/form/modal，不涉及 placeholder 替代 label）

**结论**：本次改动零 AI-slop 风险——所有视觉决策由既有 Naive UI 设计系统接管，无自定义样式引入。
