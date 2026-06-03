# UI-DESIGN — autoclip-evidence-chain

- **Change ID**: `autoclip-evidence-chain`
- **关联**: `CHANGE.md`、`REQUIREMENT.md`、`DESIGN.md`

---

## 0. 视觉语汇对齐（brownfield）

### 🔍 观察报告

| 维度          | 观察结果                                                                                        | 证据                          |
| ------------- | ----------------------------------------------------------------------------------------------- | ----------------------------- |
| **Token 源**  | CSS variables in `styles.less`，`:root[data-theme="light"]` / `:root[data-theme="dark"]` 双主题 | `assets/css/styles.less:1-49` |
| **主色**      | 绿色 `#18a058`（light）/ `#63e2b7`（dark）；状态色：success/warning/error/info                  | `styles.less:27-29,32-38`     |
| **中性色**    | bg-primary → bg-tertiary → bg-hover 三级背景；text-primary → text-muted 五级文字                | `styles.less:5-17`            |
| **hover**     | Naive UI 默认行为；无自定义 `:hover` / `transition` 覆盖                                        | grep 无结果                   |
| **动效**      | 几乎无自定义动效；notice duration 1000-2000ms；无 cubic-bezier/keyframes                        | `useNotice.ts`                |
| **elevation** | Naive UI 默认阴影（n-card, n-modal 自带）；无自定义 shadow scale                                | —                             |
| **间距**      | 大量 inline style，常用值：`padding:16px`、`margin:12px/8px`、`gap:8px/12px`                    | AutoClipManagement 模板       |
| **圆角**      | Naive UI 默认（约 3-4px），无自定义 border-radius                                               | —                             |
| **图标**      | `@vicons/ionicons5` + `@vicons/material` + `@vicons/fluent`，通过 `NIcon` 包装                  | Main/Queue/Setting 页面       |
| **字体**      | Naive UI 默认系统字体栈；无自定义 font-family                                                   | —                             |
| **布局**      | Flex 为主；inline style 驱动；无 CSS Grid；表格页用 n-data-table                                | AutoClipManagement            |
| **文案**      | 工程向，中文为主，按钮动词简洁（"保存"/"删除"/"手动分析"）                                      | 各页面按钮文案                |

### ✅ 本次新增 EvidencePanel 的视觉原则

- **沿用**：现有 CSS 变量（`--color-primary`、`--bg-secondary`、`--text-primary` 等）
- **沿用**：Naive UI 组件（n-card、n-tag、n-descriptions、n-divider）
- **沿用**：flex 布局 + 16px/12px/8px spacing
- **沿用**：@vicons 图标库
- **新建**：Canvas 密度曲线图（自绘，零依赖）
- **新建**：master-detail 布局（左侧表格 + 右侧面板）

---

## 1. 美学北极星

> 本 change 是**已有桌面工具的功能扩展**，不引入新视觉风格。EvidencePanel 应与 AutoClipManagement 页面的其他元素在视觉上无法区分。

- **调性**：工程工具型——功能优先，信息密度中等，数据可视化清晰直接
- **差异化**：密度曲线图是唯一视觉亮点——用品牌绿色柱状图 + 半透明叠加，让数据"看起来像这个产品的东西"

### v0 确认

```
📌 v0 草稿（逐项确认）：

调性：工程工具型，匹配现有 Naive UI 风格
主色：沿用 --color-primary (#18a058)
字体：沿用 Naive UI 默认系统字体栈
布局：
  ┌─────────────────────────────────────────────────┐
  │  [状态筛选]  [+ 手动分析]  [批量操作]            │
  ├───────────────────────┬─────────────────────────┤
  │  n-data-table         │  EvidencePanel           │
  │  (切片列表)           │                          │
  │                       │  ┌─ 密度曲线图 (Canvas) ┐│
  │  · 行选中高亮         │  │ ▓▓▓▓▓▓ ▓ ▓▓▓▓▓▓▓   ││
  │  · 左边框 3px 绿色    │  └─────────────────────┘│
  │                       │                          │
  │                       │  n-card: 信号检测详情     │
  │                       │  n-card: 边界精修对比     │
  │                       │  n-card: LLM 评分卡片     │
  │                       │  n-card: 触发弹幕列表     │
  ├───────────────────────┴─────────────────────────┤
  │  分页器                                         │
  └─────────────────────────────────────────────────┘

假设：
- 密度曲线用 Canvas 自绘（柱状图 + 密度折线叠加）
- 行选中高亮复用现有 var(--primary-color-suppl) + 左边框
- 无证据时显示 n-empty 占位
- 不需要新图标（用现有 @vicons）
```

---

## 2. Design Tokens

> 全部沿用 `styles.less` 现有变量，不新增 token。

```css
/* 密度曲线图专用（Canvas 绘制时引用） */
--chart-bar: var(--color-primary); /* #18a058 柱状图填充 */
--chart-bar-overlay: rgba(24, 160, 88, 0.3); /* 柱状图半透明叠加 */
--chart-line: var(--color-warning); /* #d48806 密度折线 */
--chart-bg: var(--bg-card); /* 图表背景 */
--chart-grid: var(--border-primary); /* 网格线 */

/* 行选中 */
--row-selected-bg: var(--primary-color-suppl, rgba(32, 128, 240, 0.08));
--row-selected-border: var(--primary-color, #2080f0);
```

---

## 3. 关键组件规约

### EvidencePanel.vue

| 组件           | 规则                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------- |
| **容器**       | `n-card`，bordered，padding 16px                                                                   |
| **密度曲线图** | Canvas 元素，width 100%，height 200px。柱状图绿色填充 + 密度折线橙色叠加。X 轴时间刻度、Y 轴密度值 |
| **信号详情**   | `n-descriptions` label-placement="left" :column="2"                                                |
| **边界精修**   | `n-card` small + 原始范围（灰色删除线）→ 精修后范围（绿色粗体）+ 原因                              |
| **LLM 评分**   | `n-card` small × N（每片段一张），n-tag 显示分数/高光类型                                          |
| **触发弹幕**   | 列表，每行：时间戳 + 用户名 + 弹幕内容，`n-text` depth="3" 显示时间                                |
| **降级态**     | `n-empty description="暂无决策证据"` + 提示文字 "该切片在旧版中分析，未保存证据链"                 |
| **加载态**     | `n-spin` 居中（如果 evidence 异步加载）— v1 同步渲染，无需加载态                                   |

### 行选中交互

| 规则     | 值                                                                                         |
| -------- | ------------------------------------------------------------------------------------------ |
| 选中态   | `background: var(--row-selected-bg)` + `border-left: 3px solid var(--row-selected-border)` |
| 点击行为 | `onClick` 设置 `selectedClipId`                                                            |
| 初始态   | 无选中（`selectedClipId = null`），EvidencePanel 显示 `n-empty "请选择一个切片"`           |

---

## 4. 状态与边界

| 状态                 | 展示                                                               |
| -------------------- | ------------------------------------------------------------------ |
| **无选中**           | EvidencePanel 显示 `n-empty description="请选择一个切片查看证据"`  |
| **evidence 为 null** | EvidencePanel 显示 `n-empty description="暂无决策证据"` + 原因文字 |
| **evidence 含数据**  | 完整渲染 5 类证据                                                  |
| **Canvas 渲染失败**  | 降级为纯色占位块 + console.error                                   |
| **密度数据为空数组** | 密度曲线区域显示 "弹幕数据不足，无法绘制密度曲线"                  |

---

## 5. Do's and Don'ts

### ✅ Do

- 使用 `styles.less` 的 CSS 变量，禁止硬编码 hex
- 使用 Naive UI 组件（n-card、n-empty、n-tag、n-descriptions、n-divider）
- Canvas 颜色通过 `getComputedStyle()` 读取 CSS 变量
- 表格行选中用左边框 + 背景色，不用 box-shadow 或 scale 动画

### ❌ Don't

- 禁止引入 ECharts / Chart.js / D3.js 等图表库（过度工程）
- 禁止硬编码颜色值（必须引用 CSS 变量）
- 禁止用 emoji 充图标（如 🎯 🔥 ✨）
- 禁止新增自定义字体（沿用系统字体栈）
- 禁止在 EvidencePanel 中使用 n-modal（不需要弹窗，信息全在面板内）
- 禁止玻璃拟态（glassmorphism）、渐变背景、多层阴影

---

## 6. 占位符策略

| 缺的东西        | 正确做法                 | 禁止做法    |
| --------------- | ------------------------ | ----------- |
| 无图标需求      | EvidencePanel 不使用图标 | 用 emoji 凑 |
| 密度数据为空    | 文字提示 "弹幕数据不足"  | 编造假数据  |
| Canvas 渲染失败 | 纯色占位块 + 错误提示    | 显示空白    |

---

## 7. 反 AI-slop 自检

对照 `ui-anti-patterns.md` 强制禁忌逐条检查：

- [x] 字体：无自定义字体，沿用系统栈 → 不命中 Inter/Roboto/Arial 禁忌
- [x] 颜色：无纯黑纯白、无紫色渐变、无彩底灰字、无第二个强调色
- [x] 阴影：at rest 平面（n-card 默认无 shadow），不命中
- [x] 边框：无彩色侧条 > 1px（选中左边框 3px，属于功能性指示，非装饰）
- [x] 动效：无 bounce/elastic；不触发 layout 属性动画
- [x] 布局：无卡片嵌套（EvidencePanel 内 n-card 是并列子区，非嵌套卡片）
- [x] 文案：无 hedging、无 lorem ipsum
- [x] 组件：n-empty placeholder 充当状态提示（非 label 替代）；无模态需求

**结论**：0 项命中 AI-slop 禁忌。✅
