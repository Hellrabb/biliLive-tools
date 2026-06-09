# REQUIREMENT: AutoClip 导出支持自定义 FFmpeg 预设 + 参数预览

- **Change ID**: autoclip-ffmpeg-custom
- **关联**: `@.specs/autoclip-ffmpeg-custom/CHANGE.md`、`@.specs/CONTEXT.md`

---

## 用户故事

- **US-1**（Bug 修复）：作为 AutoClip 用户，我已在 FFmpeg 预设管理页面创建了自定义编码预设，我想在 AutoClip 导出设置的下拉中看到它，以便复用已保存的编码配置。
- **US-2**（内置预设可见）：作为 AutoClip 用户，我想在下拉中同时看到内置预设和自定义预设，以便无需先创建自定义预设就能选择任一编码方案。
- **US-3**（参数预览）：作为 AutoClip 用户，我想在选中一个 FFmpeg 预设后看到它的关键参数，以便确认编码设置而不用切换到预设管理页面。
- **US-4**（编码器同步）：作为 AutoClip 用户，我想在选中预设后 `encoder` 字段自动同步为预设中的编码器值，以保持导出设置的一致性。
- **US-5**（快速跳转）：作为 AutoClip 用户，我想从 AutoClip 对话框一键跳转到 FFmpeg 预设管理页面，以便快速编辑自定义预设。

## 验收准则（AC）

### AC-1 · 自定义预设出现在下拉中（Bug 修复）

- **Given** 用户已在 FFmpeg 预设管理页面保存了至少一个自定义预设（例如 "My AV1"），且 AutoClip 预设对话框已打开
- **When** 用户切换到"导出设置"tab，FFmpeg 预设下拉数据加载完成
- **Then** "FFmpeg 预设"下拉的"自定义"分组中包含 "My AV1"，可正常选中
- **验证方式**: 手动 UAT-1 — 在设置页创建 FFmpeg 预设 → 打开 AutoClip 对话框 → 检查下拉

### AC-2 · 下拉展示内置 + 自定义预设（分组）

- **Given** AutoClip 预设对话框已打开，"导出设置"tab 已激活
- **When** 用户点击"FFmpeg 预设"下拉
- **Then** 下拉显示两个分组：
  - "基础"组：包含所有 `baseFfmpegPresets`（如 "H.264(NVIDIA NVEnc)"、"H.265(NVIDIA NVEnc)"、"AV1(NVIDIA NVEnc)" 等）
  - "自定义"组：包含用户保存的所有自定义预设；如果用户未创建任何自定义预设，"自定义"组为空或隐藏
- **Also** 每个选项显示预设名称（`name` 字段），不是内部 ID
- **验证方式**: 手动 UAT-2 — 下拉分组可见 + 内置预设可选中 + 自定义预设（如有）可选中

### AC-3 · 选中预设后显示参数预览（只读）

- **Given** AutoClip 导出设置 tab 已打开，任意预设未被选中
- **When** 用户从"FFmpeg 预设"下拉选择一个预设（例如内置 "H.265(NVIDIA NVEnc)"）
- **Then** 下拉下方出现只读预览区域，显示：

  | 参数     | 示例值     |
  | -------- | ---------- |
  | 编码器   | hevc_nvenc |
  | 码率控制 | VBR        |
  | 码率     | 8000 kbps  |
  | Preset   | p3 (fast)  |
  | CRF      | 28         |
  | 10-bit   | 否         |
  - 参数值来源于该预设的 `config` 对象
  - Preset 值附带其 label 文本（如 `p3` → "p3 (fast)"），通过匹配 `nvencPresets` / `qsvPresets` / `amfPresets` 等枚举映射

- **Also** 预览区域底部显示："编辑此预设 →" 链接（自定义预设）或 "内置预设 · 在预设管理中复制后编辑" 提示（内置预设）
- **Also** 当用户清空预设选择（clearable），预览区域消失
- **验证方式**: 手动 UAT-3 — 选不同预设 → 查看预览参数是否对应变化；选内置预设 → 查看提示文案

### AC-4 · 选中预设后自动同步 encoder 字段

- **Given** AutoClip 导出设置 tab 已打开，encoder 字段当前值为 "libx264"
- **When** 用户从"FFmpeg 预设"下拉选择 "H.265(NVIDIA NVEnc)"（内部 encoder 为 "hevc_nvenc"）
- **Then** encoder 字段的值自动变为 "hevc_nvenc"
- **Also** 用户之后**手动**将 encoder 改为其他值（如 "libx265"）——encoder 字段接受修改，预设选择保持不变（两者可偏离，用户自行负责）
- **Also** 当用户清空预设选择，encoder 字段保持当前值不变
- **验证方式**: 手动 UAT-4 — 选不同预设 → 观察 encoder 同步；手工改 encoder → 预设不丢失

### AC-5 · 跳转链接可操作

- **Given** 用户已选中的是一个自定义预设，预览区域可见
- **When** 用户点击"编辑此预设 →"链接
- **Then** 当前对话框关闭（或保持打开），浏览器跳转到 FFmpeg 预设管理页面（路由 `/settings` → FFmpeg 预设 tab）
- **Also** 如果选中内置预设，"编辑此预设 →"链接不显示，替换为提示文本"内置预设 · 在预设管理中复制后编辑"，不包含跳转链接（或链接指向预设管理页但不预选中任何预设）

- **验证方式**: 手动 UAT-5 — 选自定义预设 → 点链接 → 跳转到预设管理页

### AC-6 · 加载失败时不再静默吞错

- **Given** HTTP 服务正常运行，但 `/preset/ffmpeg/options` 请求因网络或服务端异常失败
- **When** AutoClip 预设对话框打开，`loadFfmpegPresets()` 执行
- **Then** 用户收到一条错误通知（使用已有的 `notice.error()` 机制），内容包含"FFmpeg 预设加载失败"
- **Also** 预设下拉显示为空，但允许用户手动填写 encoder 字段，不影响其他导出设置的编辑
- **验证方式**: 手动 UAT-6 — 模拟 API 不可用 → 打开对话框 → 应出现错误提示

---

## 范围切分

### v1（本次必做）

- AC-1：自定义预设出现在下拉中（Bug 修复）
- AC-2：下拉分组展示内置 + 自定义预设
- AC-3：选中预设后参数预览（只读）
- AC-4：选中预设后 encoder 自动同步
- AC-5：跳转链接到预设管理页
- AC-6：加载失败错误通知

### v2（下一轮考虑，不本次）

- 在 AutoClip 对话框内**可编辑**预设参数（完整版内联编辑）
- 在 AutoClip 对话框内从零创建新 FFmpeg 预设
- 预设参数预览时高亮与 `encoder` 字段的差异（如选中 AV1 预设但 encoder 被手动改为 h264 时给出警告）

### out（永远不做）

- 移除 `encoder` 独立字段、完全由 `ffmpegPresetId` 替代——需兼容旧预设数据
- 改动 AutoClip 后端导出管线（`resolveExportPresets()` / `exportPipeline.ts`）
- 为 AutoClip 构建一套独立的 FFmpeg 配置模型（不复用现有 FFmpegPreset 体系）

---

## 非功能性需求

- **性能**: 无（预设拉取是单次 HTTP 请求，数据量 < 10KB，预期 < 200ms）
- **可访问性**: 参数预览区域为纯文本，不引入新的可访问性问题
- **安全**: 无——不改变后端 API，不引入新的用户输入点
- **兼容性**: 延续 Naive UI 组件体系，Vue 3 Composition API，不新增依赖
- **可观测性**: 在现有日志框架下，`loadFfmpegPresets()` 失败时记录 warn 日志

## 依赖与假设

- **依赖**: `GET /preset/ffmpeg/options` API（已存在于 `packages/http/src/routes/preset.ts:67-69`）返回格式稳定
- **依赖**: Naive UI `<n-select>` 支持嵌套 group options（假设 `type: 'group'` 模式生效）
- **假设**: 用户已在 FFmpeg 预设管理页面创建了自定义预设 → `CommonPreset.list()` 能从 JSON 文件正确读取
- **假设**: 跳转到 FFmpeg 预设管理页的方式是通过 Vue Router 导航到 `/settings` 并携带 query 参数激活对应 tab

---

> AC 是 TEST 阶段派生用例的唯一来源，禁止在 TEST 阶段引入新 AC。
