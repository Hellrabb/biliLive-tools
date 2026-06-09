# UI-DESIGN · autoclip-upload-template-ui

> 关联：`CHANGE.md` / `REQUIREMENT.md` / `DESIGN.md`
> 日期：2026-06-08
> 类型：brownfield · 既有表单扩展

---

## 0. 视觉语汇对齐（brownfield）

> 本次改动在已有的 `AutoClipPresetDialog.vue`「导出设置」tab 中新增 B站模板表单字段。
> 视觉语汇 100% 继承既有 Naive UI 表单模式，零新设计元素。

| 维度     | 既有模式（沿用）                                                       |
| -------- | ---------------------------------------------------------------------- |
| 表单组件 | `n-form` + `n-form-item` 双层结构                                      |
| 表单标签 | `n-form-item label="中文标签"`                                         |
| 文本输入 | `n-input`，placeholder 用中文描述                                      |
| 开关     | `n-switch`，无额外标签                                                 |
| 下拉     | `n-select`，label-field="name", value-field="id"                       |
| 级联     | `n-cascader`，用于分区选择（与 BiliSetting 一致）                      |
| 反馈提示 | `<template #feedback>` + `<span style="font-size: 12px; color: #999">` |
| 数字单位 | `<span style="margin-left: 4px">单位</span>`                           |
| 条件显隐 | `v-if` 直接控制 `n-form-item`                                          |
| 弹窗布局 | 左侧预设列表 + 右侧 900px 编辑区，tabs segment 风格                    |
| 主题     | Naive UI 内置 light/dark，无自定义 token 覆盖                          |
| 弹幕标签 | `<dynamic-tags>` 组件（从 BiliSetting.vue import 复用）                |

### v0 确认记录

- v0 草稿已在 2026-06-08 展示，用户确认 go
- 用户追加需求：封面自动提取（选 A，纳入 v1）
- 偏差修正：封面字段从「路径输入」改为「留空自动提取 + 可选手动覆盖」

---

## 1. 美学北极星

> 继承项目既有 Naive UI 默认美学。不新增独立设计方向。

- **目的**：让用户在同一个弹窗内完成切片导出到 B站投稿的全部配置
- **调性**：工具型桌面应用的 settings 风格 — 功能直白、标签中文、提示到位
- **约束**：不引入新 CSS 文件、不新增 npm 依赖、不改变弹窗结构
- **差异化**：无（功能页，不做视觉差异化）

---

## 2. 表单布局规约

### 2.1 条件显隐规则

```
uploadToBili = false  →  以下字段全部隐藏
uploadToBili = true   →  显示 B站模板表单区

copyright = 1 (自制)  →  显示「禁止转载」开关
copyright = 2 (转载)  →  显示「转载来源」输入框
```

### 2.2 字段清单与组件映射

| 字段      | 组件                      | 属性                                                           |
| --------- | ------------------------- | -------------------------------------------------------------- |
| 标题模板  | `n-input`                 | placeholder: `"{{highlightTitle}} - {{roomName}}【直播切片】"` |
| 标签      | `DynamicTags`             | `:max="10"`, 复用 BiliSetting 的同款组件                       |
| 投稿分区  | `n-cascader`              | `:options="areaData"`, `check-strategy="child"`, `filterable`  |
| 自制/转载 | `n-radio-group`           | 两个 `n-radio`：自制(value=1)、转载(value=2)                   |
| 禁止转载  | `n-switch`                | v-if="copyright === 1"                                         |
| 转载来源  | `n-input`                 | v-if="copyright === 2", placeholder: "注明视频来源网址"        |
| 简介模板  | `n-input type="textarea"` | placeholder: "本视频由AI自动切片生成\n直播间：{{roomName}}"    |
| 封面图    | `n-input`                 | placeholder: "留空自动提取高光帧作为封面"                      |

### 2.3 变量提示

每个支持模板变量的字段（标题模板、简介模板）下方显示统一的 feedback：

```
<span style="font-size: 12px; color: #999">
  可用变量：{{ "{{" }}highlightTitle{{ "}}" }} {{ "{{" }}roomName{{ "}}" }} {{ "{{" }}date{{ "}}" }} {{ "{{" }}uploadDate{{ "}}" }}
</span>
```

### 2.4 默认值

| 字段          | 默认值                 |
| ------------- | ---------------------- |
| titleTemplate | `"{{highlightTitle}}"` |
| tag           | `["biliLive-tools"]`   |
| tid           | `138`                  |
| copyright     | `1`                    |
| noReprint     | `0`                    |
| source        | `""`                   |
| descTemplate  | `""`                   |
| cover         | `""`                   |

---

## 3. 封面自动提取（v1 新增强）

### 3.1 行为规范

- **触发条件**：`uploadToBili = true` 且 `biliUpTemplate.cover` 为空字符串（未手动指定）
- **提取时间点**：`highlight.bestRange` 的中间秒数
- **保存路径**：`{userDataPath}/cover/auto_clip_{hash}.jpg`
- **失败处理**：帧提取失败 → 不上传封面，不中断投稿流程
- **手动覆盖**：用户在封面输入框中指定路径 → 跳过自动提取，直接用指定文件

### 3.2 UI 表现

封面字段的 feedback 提示：

```
<span style="font-size: 12px; color: #999">留空自动从高光时刻提取封面，或手动指定图片路径</span>
```

---

## 4. Design Tokens

无新增。全量继承 Naive UI 默认 token 体系。

表单内唯一使用的自定义 style：

```css
/* feedback 提示文字 */
font-size: 12px;
color: #999;

/* 单位后缀 */
margin-left: 4px;
```

---

## 5. 关键组件规约

### 5.1 Button

无新增按钮。保存操作复用既有 `n-button type="primary" @click="savePreset"`。

### 5.2 Form field

沿用既有模式：

```html
<n-form-item label="标签">
  <DynamicTags v-model="editingPreset.config.export.biliUpTemplate.tag" :max="10" />
  <template #feedback>
    <span style="font-size: 12px; color: #999">回车添加标签，最多10个</span>
  </template>
</n-form-item>
```

### 5.3 广播组（copyright）

```html
<n-form-item label="自制/转载">
  <n-radio-group v-model:value="editingPreset.config.export.biliUpTemplate.copyright">
    <n-radio :value="1">自制</n-radio>
    <n-radio :value="2">转载</n-radio>
  </n-radio-group>
</n-form-item>
```

### 5.4 分区级联选择（tid）

复用 BiliSetting 的 `areaData` localStorage 缓存：

```typescript
const areaData = ref(JSON.parse(localStorage.getItem("areaData") || "[]"));
```

组件：

```html
<n-form-item label="投稿分区">
  <n-cascader
    v-model:value="editingPreset.config.export.biliUpTemplate.tid"
    :options="areaData"
    label-field="name"
    value-field="id"
    check-strategy="child"
    filterable
  />
</n-form-item>
```

### 5.5 DynamicTags

从 `BiliSetting.vue` 的 import 路径复用：

```typescript
import DynamicTags from "./DynamicTags.vue";
```

---

## 6. Do's and Don'ts

| ✅ Do                                          | ❌ Don't                              |
| ---------------------------------------------- | ------------------------------------- |
| 表单字段全部用中文 label                       | 不要引入新的 CSS 文件或 class         |
| 条件显隐用 `v-if` 直接控制 `n-form-item`       | 不要用 `v-show`（隐藏字段仍占用空间） |
| feedback 提示用 `font-size: 12px; color: #999` | 不要自定义 n-form-item 的 label-width |
| 模板变量用 `replaceAll('{{key}}', val)`        | 不要引入 ejs/handlebars               |
| 分区数据从 localStorage 读缓存                 | 不要每次打开弹窗调 API                |
| 封面提取失败不中断上传                         | 不要让封面提取成为上传前置条件        |

---

## 7. 占位符策略

| 缺的东西   | 做法                                                      |
| ---------- | --------------------------------------------------------- |
| 分区列表   | 从 localStorage `areaData` 缓存读；无缓存时用内置最小列表 |
| 标签初始值 | 默认 `["biliLive-tools"]`，用户可删改                     |
| 封面图     | 自动提取 > 用户手动路径 > 不上传（三级 fallback）         |
| 数据       | 不编造。所有默认值来自 `DEFAULT_BILIUP_CONFIG`            |

---

## 8. 反 AI-slop 自检

| 检查项                            | 结果                                    |
| --------------------------------- | --------------------------------------- |
| 是否使用 Inter / Roboto / Arial？ | N/A — 字体由 Naive UI 控制，未新增      |
| 是否用 emoji 充图标？             | 否 — 无图标需求                         |
| 是否编造数据？                    | 否 — 默认值来自 `DEFAULT_BILIUP_CONFIG` |
| 颜色是否用了 OKLCH？              | N/A — 不新增颜色                        |
| 是否引入了非 Naive UI 组件？      | 否 — 全部复用既有组件                   |
