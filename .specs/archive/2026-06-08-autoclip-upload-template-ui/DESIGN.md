# DESIGN · autoclip-upload-template-ui

> 关联：`CHANGE.md` / `REQUIREMENT.md`
> 日期：2026-06-08

---

## 0. 技术栈选定

> 锁定：沿用项目既有技术栈（TypeScript + Vue 3 + Naive UI + Electron + awilix DI）。
> 理由：本次是 brownfield 功能扩展，不引入新栈。

---

## 0.5 既有架构对齐

### 0.5.1 触碰模块清单

**会修改：**

| 文件                                                                | 既有？ | 变更类型                                                                          |
| ------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------- |
| `packages/types/src/index.ts`                                       | 既有   | 新增 `BiliUpTemplateConfig` 接口 + `AutoClipExportConfig.biliUpTemplate` 可选字段 |
| `packages/shared/src/presets/autoClipPreset.ts`                     | 既有   | `AUTO_CLIP_DEFAULT_CONFIG.export` 增加 `biliUpTemplate` 默认值                    |
| `packages/shared/src/autoClip/service.ts`                           | 既有   | `uploadToBili()` 数据源改为 autoclip preset                                       |
| `packages/app/src/renderer/src/components/AutoClipPresetDialog.vue` | 既有   | 导出设置 tab 新增条件表单                                                         |

**会新增：**

| 文件                                               | 说明                 |
| -------------------------------------------------- | -------------------- |
| `packages/shared/src/autoClip/templateRenderer.ts` | 模板变量替换工具函数 |

**不应触碰：**

| 禁动项                                                     | 原因                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------- |
| `packages/shared/src/presets/videoPreset.ts`               | 与本次无关，DEFAULT_BILIUP_CONFIG 保持不变作为 fallback |
| `packages/shared/src/task/bili.ts`                         | 上传核心逻辑不修改，只改数据来源                        |
| `packages/app/src/renderer/src/components/BiliSetting.vue` | 全局 B站设置不修改                                      |
| `packages/shared/src/index.ts`                             | `init()` 签名不动                                       |

### 0.5.2 对齐既有抽象

| 本次需要        | 既有有没有？                                                         | 决定                                                                         |
| --------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 模板变量替换    | `webhook.ts:formatPartTitle()` 有 `.replaceAll('{{var}}', val)` 模式 | **沿用** 简化版（不用 ejs，只用 replaceAll）                                 |
| B站稿件参数类型 | `BiliupConfig` (30+ 字段)                                            | **沿用** 字段名/类型一致，新类型 `BiliUpTemplateConfig` 为 `Pick<>` 精简子集 |
| 分区列表        | `BiliSetting.vue` 用 `n-cascader` + localStorage `areaData`          | **沿用** localStorage 缓存数据源                                             |
| 动态标签        | `BiliSetting.vue` 用 `<dynamic-tags>` 组件                           | **沿用** 同一组件                                                            |
| 预设 CRUD       | `CommonPreset` 基类 + `autoClipPreset` singleton                     | **沿用**，不新增预设类型                                                     |
| 表单组件库      | Naive UI (`n-input`, `n-switch`, `n-select`, `n-dynamic-tags`)       | **沿用**                                                                     |

### 0.5.3 沿用模式 vs 引入新模式

- **数据流**：沿用 « preset → service → biliApi » 链，只改 preset 内部数据来源（videoPreset → autoClipPreset）
- **表单组织**：沿用现有 `AutoClipPresetDialog.vue` 的 tab-based 布局 + `n-form` 组件
- **模板渲染**：沿用 `webhook.ts` 的 `.replaceAll('{{key}}', value)` 模式，不引入 ejs/handlebars
- **分区数据**：沿用 localStorage 缓存 + B站 API 获取模式（与 BiliSetting.vue 一致）
- **无新模式引入**

---

## 1. 技术决策

### 决策 1：类型设计 — 新建 `BiliUpTemplateConfig` 子类型

**决策**：建 `BiliUpTemplateConfig` 作为 `BiliupConfig` 的精简 Pick，嵌入 `AutoClipExportConfig`。

**备选**：直接在 `AutoClipExportConfig` 里平铺字段，不复用 `BiliupConfig` 类型。

**选择理由**：

- 新类型与 BiliupConfig 字段名保持一致（tag/tid/copyright/source/cover/noReprint），未来如需扩展只需加字段
- TypeScript 的 `Pick<BiliupConfig, ...>` 不能直接用于运行时默认值构造，不如显式定义接口
- 平铺会让 `AutoClipExportConfig` 过于膨胀

**代价**：多维护一个接口定义；`BiliupConfig` 变更时不自动同步

### 决策 2：模板变量引擎 — 纯字符串 replaceAll

**决策**：用 `String.replaceAll('{{key}}', value)` 做模板渲染，不引入模板库。

**备选**：用 ejs（已在 `webhook.ts` 中使用），或引入 handlebars。

**选择理由**：

- `webhook.ts` 已有 `.replaceAll` 后备模式（ejs 失败后走这步），简化版对此场景够用
- 变量数量少（4 个），无循环/条件语法需求
- 不引入新依赖，bundle 不膨胀

**代价**：未来若需复杂模板语法（条件、循环）需重构

### 决策 3：模板变量上下文传递

**决策**：在 `analyzeAndSave` 中构建 `TemplateContext` 对象，沿调用链传递到 `uploadToBili`。

```typescript
// 伪代码 - 函数签名设计
interface TemplateContext {
  highlightTitle: string;
  roomName: string; // 从 recorder 获取
  date: string; // 录制日期 YYYY-MM-DD
  uploadDate: string; // 上传日期 YYYY-MM-DD
}
```

**备选**：只从 `HighlightSegment` 取数据，不支持 `roomName`/`date` 变量；或从 videoPath 文件名解析。

**选择理由**：

- `recorderId` 已在 `analyzeAndSave` 参数中可用，可通过 recorderManager 获取 roomName
- 用户明确要求支持 `{{roomName}}` 和 `{{date}}`
- 文件名解析不可靠（不同平台命名格式不同）

**代价**：需要在 pipeline 中额外传递 context 对象

### 决策 4：上传数据源切换（videoPreset → autoClipPreset）

**决策**：`uploadToBili()` 直接读 `presetConfig.export.biliUpTemplate`，不再查找 videoPreset "autoClip"。

**备选**：优先级链 — 先读 autoclip preset，无则 fallback videoPreset "autoClip"，再无则默认值。

**选择理由**：

- 用户明确 "不管旧的"（Q3 已确认）
- 删掉 videoPreset 查找逻辑，代码更简单
- DEFAULT_BILIUP_CONFIG 仍作为 biliUpTemplate 未配置时的默认值来源

**代价**：已有 "autoClip" videoPreset 配置的用户需手动迁移到新的 autoclip 预设中

### 决策 5：分区数据源

**决策**：从 `localStorage.getItem('areaData')` 读取缓存分区列表；若无则用内置最小列表。

**备选**：每次打开弹窗时调用 B站 API；或用硬编码分区列表。

**选择理由**：

- `BiliSetting.vue` 已将分区数据写入 localStorage 缓存（`areaData` 键），直接复用
- 不需要额外 API 调用，弹窗打开即时
- 内置最小列表（10+ 常用分区）作为 offline fallback

**代价**：如果用户从未访问过 B站设置页，areaData 为空，显示内置最小列表

---

## 2. 数据流

```
用户配置 AutoClipPreset（UI）
  │
  │ export.biliUpTemplate = { titleTemplate, tag, tid, ... }
  ▼
AutoClipPresetDialog → savePreset() → CommonPreset.save()
  │
  │ 持久化到 autoClipPresetPath JSON 文件
  ▼
录制完成 → analyzeAndSave()
  │
  │ 1. 加载 preset (含 biliUpTemplate)
  │ 2. 构建 TemplateContext { highlightTitle, roomName, date, uploadDate }
  │ 3. 走 pipeline → 导出切片
  ▼
autoExportAndUpload()
  │
  │ export.uploadToBili === true
  ▼
uploadToBili(results, appConfig)
  │
  │ 1. 读 presetConfig.export.biliUpTemplate
  │ 2. 对每个 highlight:
  │    a. applyTemplateVariables(titleTemplate, context) → finalTitle
  │    b. applyTemplateVariables(descTemplate, context) → finalDesc
  │    c. 合并 → { ...defaultValues, ...biliUpTemplate, title: finalTitle, desc: finalDesc }
  │ 3. biliApi.addMedia([{ path, title }], mergedConfig, uid)
  ▼
B站投稿任务队列 (TaskQueue)
```

### 模板变量解析子流程

```
Input:  "{{highlightTitle}} - {{roomName}}【直播切片】"
Context: { highlightTitle: "五杀瞬间", roomName: "某某直播间", date: "2026-06-08", uploadDate: "2026-06-08" }

Step 1: replaceAll('{{highlightTitle}}', '五杀瞬间')
Step 2: replaceAll('{{roomName}}', '某某直播间')
Step 3: replaceAll('{{date}}', '2026-06-08')
Step 4: replaceAll('{{uploadDate}}', '2026-06-08')

Output: "五杀瞬间 - 某某直播间【直播切片】"
```

---

## 3. ADR

本次无不可逆架构决策。所有决策（模板引擎选型、类型设计、数据源切换）均为 change 级，可后续 refactor 调整。不单独出 ADR。

---

## 4. 风险

| #   | 风险                                                   | 类型      | 缓解                                                                   |
| --- | ------------------------------------------------------ | --------- | ---------------------------------------------------------------------- |
| R1  | `roomName` 获取失败（recorderManager 中无此 recorder） | 实现风险  | `TemplateContext.roomName` 默认为空字符串，标题不会崩                  |
| R2  | 旧预设无 `biliUpTemplate` 字段，反序列化后 `undefined` | 上线风险  | `uploadToBili()` 用 `??` 回退到 `DEFAULT_BILIUP_CONFIG` 的字段级默认值 |
| R3  | 分区 localStorage 数据格式变更（B站 API 升级）         | 长期债务  | 内置最小分区列表作为 fallback；读取时 try/catch                        |
| R4  | 用户输入包含 `{{` 字面量（非变量）与模板语法冲突       | 边界 case | 变量名严格白名单匹配，未识别的 `{{xxx}}` 原样保留不替换                |
| R5  | 模板渲染后的 title 超过 B站 80 字符限制                | 边界 case | 渲染后 `trim().slice(0, 80)` 截断                                      |

---

## 5. 不在范围内

- 封面图片上传/选择（v2）
- 标题模板实时预览（v2）
- 分区级联搜索增强（v2）
- 多语言 i18n 支持
- videoPreset "autoClip" 已有的用户数据自动迁移

---

## 9. 架构沉淀建议

### 9.1 新增可复用抽象

| 抽象                       | 路径                           | 复用场景                                                         |
| -------------------------- | ------------------------------ | ---------------------------------------------------------------- |
| `applyTemplateVariables()` | `autoClip/templateRenderer.ts` | webhook 通知模板、弹幕样式模板、文件名模板 — 均可用统一 renderer |

### 9.2 项目级技术决策

| 决策         | 内容                                                                                   |
| ------------ | -------------------------------------------------------------------------------------- |
| 模板变量规范 | 全项目模板变量统一用 `{{camelCaseVar}}` 格式，`replaceAll` 替换（不再引入 ejs 新场景） |

### 9.3 跨模块契约

| 契约点                 | 变更                                                            |
| ---------------------- | --------------------------------------------------------------- |
| `AutoClipExportConfig` | 新增 `biliUpTemplate?: BiliUpTemplateConfig` 字段               |
| `uploadToBili()` 签名  | 需新传入 `presetConfig: AutoClipConfig`，不再内部查 videoPreset |

### 9.4 依赖变动

无。不新增/升级/替换任何 npm 包。

### 9.5 禁动清单变动

无新增禁动项。
