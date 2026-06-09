# DESIGN: AutoClip 导出支持自定义 FFmpeg 预设 + 参数预览

- **Change ID**: autoclip-ffmpeg-custom
- **关联**: `@.specs/autoclip-ffmpeg-custom/REQUIREMENT.md`、`@.specs/CONTEXT.md`
- **作者**: AI（Architect 角色）+ 人工 review

---

## 0. 技术栈选定

> brownfield 项目，沿用既有技术栈，无新增选择。

- **选定**：既有栈（Vue 3 + Naive UI + TypeScript）
- **前端**：Vue 3.5 (Composition API) + Naive UI 2.44 + Pinia 3
- **后端**：Koa (HTTP API，`GET /preset/ffmpeg/options` 已存)
- **数据库**：N/A（读取 JSON 文件，无 DB 操作）
- **部署**：Electron 桌面应用 + Docker 全栈镜像
- **关键依赖**：vue-router (hash mode)、`@renderer/apis/presets`（已有 ffmpegPresetApi）、`@biliLive-tools/shared/enum.js`（已有 videoEncoders / nvencPresets 等枚举）
- **理由**：改动限于 AutoClipPresetDialog.vue 单组件 + Home 页面 query 参数支持，不需引入新依赖
- **明确排除**：不引入独立的状态管理方案（改动用组件内 ref 即可）；不引入新的 UI 库

---

## 0.5 既有架构对齐（brownfield）

### 0.5.1 本次 change 触碰的既有模块

```
触碰模块（实际 grep 结果）：
- packages/app/src/renderer/src/components/AutoClipPresetDialog.vue（既有 · 主战场）
- packages/app/src/renderer/src/apis/presets/ffmpeg.ts（既有 · 已有 options() 方法，本次启用）
- packages/app/src/renderer/src/apis/presets/index.ts（既有 · 导出路径不变）
- packages/app/src/renderer/src/pages/Home/index.vue（既有 · 需加 query tab 支持）
- packages/app/src/renderer/src/routers/index.ts（既有 · route name="Home" / path="/home"）

会新增：
- 无新文件（所有改动在既有文件内）

禁动清单（与本次无关，AI 不许"顺手"碰）：
- packages/shared/src/autoClip/exportPipeline.ts（后端导出管线）
- packages/shared/src/presets/ffmpegPreset.ts（后端预设管理器）
- packages/http/src/routes/preset.ts（API 路由）
- AutoClipPresetDialog.vue 中非导出 tab 的其他部分（信号检测 / LLM / 边界精修 tab）
```

### 0.5.2 既有抽象沿用对照表

| 本次需要                 | 既有有没有？路径                                                       | 决定 |
| ------------------------ | ---------------------------------------------------------------------- | ---- |
| 获取分组 FFmpeg 预设列表 | `ffmpegPresetApi.options()` → `GET /preset/ffmpeg/options`（API 已存） | 沿用 |
| Naive UI 分组下拉        | `<n-select>` 支持 `type: 'group'`（Naive UI 已支持）                   | 沿用 |
| 编码器枚举列表           | `videoEncoders` from `@biliLive-tools/shared/enum.js`（已 import）     | 沿用 |
| 错误通知                 | `useNotice()` → `notice.error()`（已有 hook）                          | 沿用 |
| 路由跳转                 | `vue-router` → `useRouter().push()`（框架已集成）                      | 沿用 |
| Preset label 映射        | `nvencPresets` / `qsvPresets` / `amfPresets` from enum.js              | 沿用 |
| 确认对话框               | `useConfirm()` → `confirm.warning()`（已有）                           | 沿用 |

### 0.5.3 沿用模式 vs 引入新模式

```
- 数据加载：**沿用** watch(visible) → async loadXxx() 模式（AutoClipPresetDialog 已有 loadPresets / loadDanmuPresets / loadFfmpegPresets）
- 状态管理：**沿用** 组件内 ref() 模式（不引入 pinia store）
- API 调用：**沿用** @renderer/apis/presets 封装（不直接调 axios）
- 错误处理：**沿用** try/catch + notice.error() 模式
- 参数预览：**引入新模式** → 只读参数卡片（既有无此模式），用 Naive UI <n-descriptions> 或手写 dl/dt/dd 结构
```

---

## 1. 决策清单

| #   | 决策                                                                          | 备选                                     | 选择理由                                                                                          | 取舍代价                                                                                                               |
| --- | ----------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| D1  | API 数据源从 `list()` 切换到 `options()`                                      | 继续用 `list()` + 手动拼接内置预设       | `options()` 返回完整分组数据，服务端已维护好内置+自定义分组逻辑                                   | 返回格式从 `[{id, name, config}]` 变为 `[{value, label, children: [{value, label, config}]}]`，前端需重新映射          |
| D2  | 参数预览用只读 `<n-descriptions>` 展示                                        | 手写 `<div>` 布局 / `<n-table>`          | `<n-descriptions>` 是 Naive UI 原生的描述列表组件，语义匹配 key-value 展示，自带 label/value slot | 需要额外 import `NDescriptions` / `NDescriptionsItem`                                                                  |
| D3  | encoder 同步为单向（预设→encoder），用户手动改 encoder 后不清空预设           | 双向同步 / 选预设后锁定 encoder          | 用户选 Q3-B（保留两者），且可能临时切换编码器做 A/B 测试。单向同步简单，不丢失用户手动选择        | 两个字段可能偏离（用户可能困惑为什么选了 H.265 预设但 encoder 显示 h264），需在 UI 上不做特别提示（AC 未要求差异警告） |
| D4  | 跳转链接用 `router.push({ path: '/home', query: { tab: 'ffmpeg-setting' } })` | `window.open` / 弹出独立的预设编辑对话框 | vue-router 导航与现有 Main 布局一致，不需要新开窗口                                               | 需在 Home 页面新增 query tab 读取逻辑（~5行代码），跳转后 AutoClip 对话框会关闭（用户需重新打开）                      |
| D5  | 内置预设不可编辑，link 替换为提示文本                                         | 对所有预设都显示可点击链接               | 内置预设定义在 `baseFfmpegPresets` 常量中，无法持久化修改；强制用户复制后编辑更安全               | 自定义与内置预设展示不对称                                                                                             |

---

## 2. 数据流 / 架构图

```
┌─────────────────────────────────────────────────────┐
│ AutoClipPresetDialog.vue                            │
│                                                     │
│  watch(visible)  ──────────────────────┐            │
│    ├── loadPresets()                   │            │
│    ├── loadDanmuPresets()              │            │
│    └── loadFfmpegPresets()  ◀── 改动点 1             │
│          │                                        │
│          ▼                                        │
│   ffmpegPresetApi.options()                       │
│          │                                        │
│          ▼                                        │
│   GET /preset/ffmpeg/options                      │
│          │                                        │
│          ▼                                        │
│   FFmpegPreset.getFfmpegPresetOptions()           │
│     ├── baseFfmpegPresets.map()    (内置)          │
│     └── super.list().map()         (自定义)        │
│          │                                        │
│          ▼                                        │
│   [{value:"base", label:"基础", children:[...]},   │
│    {value:"custom", label:"自定义", children:[...]}]│
│          │                                        │
│          ▼                                        │
│   前端映射 → 加 type:'group' → ffmpegPresetOptions  │
│          │                                        │
│          ▼                                        │
│   <n-select :options="ffmpegPresetOptions" />      │
│          │                                        │
│    用户选 preset                                  │
│          │                                        │
│          ├──▶ 提取 config.encoder → 同步 encoder ref ◀── 改动点 4
│          │                                        │
│          └──▶ 展示参数预览卡片 ◀── 改动点 3           │
│               │ encoder / bitrateControl / bitrate │
│               │ preset / crf / bit10               │
│               │                                    │
│               └── "编辑此预设 →" link               │
│                    │                               │
│                    ▼                               │
│               router.push({ path: '/home',          │
│                 query: { tab: 'ffmpeg-setting' }})  │
│                    │                               │
│                    ▼                               │
│               Home/index.vue                       │
│                 watchEffect(query.tab) → set active │
│                 → ffmpegSetting.vue 渲染            │
└─────────────────────────────────────────────────────┘

┌─ 错误路径 ─────────────────────────────────────────┐
│  ffmpegPresetApi.options() 失败                     │
│    │                                                │
│    └──▶ catch → notice.error("FFmpeg预设加载失败")   │
│          ffmpegPresetOptions = []                   │
│          用户仍可手动填 encoder                      │
└────────────────────────────────────────────────────┘
```

---

## 3. 关键状态机

`ffmpegPresetId` 与 `encoder` 的同步状态：

```
         ┌──────────┐
         │ 初始态    │  ffmpegPresetId = null, encoder = 旧值
         └─────┬────┘
               │ 用户选 preset
               ▼
         ┌──────────┐
         │ 已同步    │  ffmpegPresetId = "xxx", encoder = preset.config.encoder
         └─────┬────┘
               │
          ┌────┴────┐
          ▼         ▼
  用户清空 preset  用户手动改 encoder
          │         │
          ▼         ▼
    ┌─────────┐  ┌──────────┐
    │ 未选中   │  │ 偏离态    │  ffmpegPresetId 不变, encoder ≠ preset.encoder
    └────┬────┘  └────┬─────┘
         │            │
         │      用户重选同一个或另一个 preset
         │            │
         └────────────┘
               │
               ▼
         回到"已同步"
```

---

## 4. ADR 索引

本次无新增 ADR。所有决策可逆性高（组件内调整），不需独立 ADR 记录。

---

## 5. 风险

| #   | 风险                                                                                                         | 影响                       | 概率 | 缓解                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------ | -------------------------- | ---- | ------------------------------------------------------------------------------------------------------------ |
| R1  | Naive UI `<n-select>` group 模式下 `filterable` 与自定义 children key 兼容性问题                             | 下拉分组渲染异常           | 低   | 在 dev 环境先验证 group 渲染；如果 Naive UI 不支持自定义 key 名（默认 `children`），前端映射时确保字段名匹配 |
| R2  | `router.push` 跳转到 `/home` 后 AutoClip 对话框关闭，用户编辑完预设后找不到回来的路径                        | 用户困惑                   | 中   | 跳转前用 `notice.info("请编辑预设后回到 AutoClip 管理页面重新打开对话框")` 提示                              |
| R3  | `getFfmpegPresetOptions()` 在 HTTP 服务未启动时失败（Electron 场景），`try/catch` 改为抛通知后用户可能觉得烦 | 用户体验                   | 低   | 仅对话框首次打开时加载一次，非轮询                                                                           |
| R4  | Home 页面新增 query tab 参数读取后，与其他已有 tab 的默认行为冲突（如首次加载时 query 为空该显示哪个 tab）   | Home 页面 tab 初始状态异常 | 低   | 只在 `tab` query 存在时覆盖默认 tab，query 为空时走原有 `<n-tabs>` 默认值                                    |

---

## 6. 不在范围

- 不实现「在 AutoClip 对话框内编辑预设参数」的完整表单
- 不实现「选中预设后，encoder 字段不可更改」的锁定机制
- 不实现「自定义预设与内置预设冲突检测」（如同名覆盖）
- 不改变预设的存储格式或 API 契约
- 不修改 Home 页面的其他 tab 行为

---

## 9. 架构沉淀建议

### 9.1 新增的可复用抽象

| 路径                                                        | 能力                                           | 触发场景           | 复用建议                                                                                                             |
| ----------------------------------------------------------- | ---------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| AutoClipPresetDialog.vue 中的 `presetParamPreview` computed | 从 FFmpeg 预设 config 提取可展示的关键参数列表 | 选中 FFmpeg 预设时 | 可提取为 `useFfmpegPresetPreview(presetId)` composable，供其他需要预设预览的场景复用（如视频压制页面的预设快速预览） |

### 9.2 新增 / 改变的项目级技术决策

| 决策                      | 取值                                        | 影响范围                                             | 推翻代价                     |
| ------------------------- | ------------------------------------------- | ---------------------------------------------------- | ---------------------------- |
| FFmpeg 预设选择器 UI 模式 | 单选下拉（带分组）+ 只读参数预览 + 跳转链接 | AutoClip 导出设置、未来任何需要选择 FFmpeg 预设的 UI | 低（可随时改为内联编辑表单） |

### 9.3 新增 / 修改的跨模块契约

```
- 新增 Home 页面 query 参数：?tab=<tab-name>，用于从其他页面跳转到特定设置 tab
  - 支持的 tab 值：ffmpeg-setting / common-setting / upload-setting / danmukufactory-setting
  - 实现：Home/index.vue 用 watchEffect 读取 route.query.tab，设置 activeTab
```

### 9.4 新增 / 升级的依赖

N/A — 无新增依赖。

### 9.5 禁动清单变化

```
- 新增：Home/index.vue 的 <n-tabs> 默认 tab 值不应被硬编码覆盖——新增的 query tab 逻辑仅限于 watchEffect 内
- 新增：AutoClipPresetDialog.vue 的 loadFfmpegPresets() 不得再回退到 ffmpegPresetApi.list()
```

---

> 本文件不包含完整代码实现。
