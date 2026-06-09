# CHANGE: AutoClip 导出支持自定义 FFmpeg 预设 + 参数预览

- **Change ID**: autoclip-ffmpeg-custom
- **创建日期**: 2026-06-09
- **路径建议**: 完整（REQUIREMENT → DESIGN → UI-DESIGN → TASK → DEV → TEST → REVIEW → INTEGRATION）
- **状态**: draft

---

## Why（为什么做）

用户在"压制页面"的 FFmpeg 设置中创建了自定义 AV1 预设，但在 AutoClip 预设对话框的导出设置中，`ffmpegPresetId` 下拉找不到这个自定义预设。同时用户希望能在 AutoClip 里直观看到选中预设的关键参数，而不需要来回切换页面。

三个子问题：

1. **Bug**：自定义 FFmpeg 预设可能未正确出现在 AutoClip 下拉中（`list()` 返回为空或被静默吞错）
2. **功能缺失**：下拉只展示自定义预设，不展示内置预设（`baseFfmpegPresets`），用户无法直接用内置的 AV1 NVEnc 等预设
3. **体验差**：选了预设也看不到它的参数（编码器/码率/preset/CRF），且独立 `encoder` 字段与预设内的编码器可能矛盾

## What（做什么）

1. **修复自定义预设不显示的 bug**（排查 `loadFfmpegPresets()` → `GET /ffmpeg` → `list()` 链路，确保用户保存的预设正确加载到下拉中）
2. **下拉同时展示内置 + 自定义预设**：切换到 `/ffmpeg/options` API（已返回分组数据：基础 / 自定义），用 `<n-select>` 的 group 模式渲染
3. **选中预设后显示关键参数预览**（只读）：编码器、码率控制模式、码率值、preset 档位、CRF 值、10-bit 开关。下方加"编辑此预设 →"链接，点击跳转到 FFmpeg 预设管理页
4. **选中预设后自动同步 `encoder` 字段**：从预设 config 中提取 `encoder` 值回填到 encoder 下拉

## 影响面

- [x] 影响 `REQUIREMENT.md`
- [x] 影响 `DESIGN.md`
- [ ] 影响现有 AC
- [ ] 影响数据模型 / 迁移
- [ ] 影响外部 API 兼容性
- [ ] 仅修复 bug，无范围变化

## 范围排除（这次不做）

- 不在 AutoClip 对话框里做 FFmpeg 参数的**可编辑**表单（完整版内联编辑）——保留"跳转到预设管理页编辑"的机制
- 不改变 AutoClip 导出管线的后端逻辑（`resolveExportPresets()` / `exportPipeline.ts`），只改前端 UI 的数据加载与展示
- 不新增 FFmpeg 预设的 CRUD API（已有 `/preset/ffmpeg` 全套路由）
- 不移除或重构 `encoder` 字段的存储 schema——保留 `encoder` 字段以兼容旧预设数据

## 验收线（粗粒度，不是 AC）

1. 用户在 AutoClip 预设对话框的导出设置中，FFmpeg 预设下拉包含**所有**可选预设（内置 + 自定义），且自定义预设不会丢失
2. 选中某个预设后，下方出现编码器/码率/preset/CRF 等关键参数预览，且 `encoder` 字段自动同步为预设的编码器
3. 参数预览区域有可点击的链接，能跳转到 FFmpeg 预设管理页面

## 风险与未知

- **Bug 根因待确认**：需在用户实际环境中验证 `GET /ffmpeg` 返回值。可能原因包括：预设文件路径不匹配（dev vs Docker）、`try/catch` 静默吞错、或预设未被正确保存
- **`/ffmpeg/options` 返回格式**：是嵌套 group 结构 `[{value: "base", label: "基础", children: [...]}, {value: "custom", ...}]`，Naive UI 的 `<n-select>` 需要验证是否原生支持这种嵌套 options 格式
- **encoder 同步方向**：用户手动改 encoder 后是否要清空/反选 ffmpegPresetId？需在 DESIGN 阶段明确交互逻辑
