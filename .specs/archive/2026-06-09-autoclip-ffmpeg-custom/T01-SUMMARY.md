# T01 完成摘要 — API 切换 + 修复静默吞错

- **AC 覆盖**：AC-1、AC-2、AC-6
- **修改文件**：`packages/app/src/renderer/src/components/AutoClipPresetDialog.vue`
- **验证**：`typecheck` 通过（`node` + `web`）

## 改动

1. **`loadFfmpegPresets()`**（line 677-692）：
   - `ffmpegPresetApi.list()` → `ffmpegPresetApi.options()`
   - API 返回格式 `[{value, label, children: [{value, label, config}]}]`
   - 映射为 Naive UI n-select group 格式：每 group 加 `type: "group"`，children 映射为 `{label, value, config}`
   - `config` 保留在 option 上供 T03 使用

2. **错误处理**（line 690-692）：
   - 静默 `catch { /* comment */ }` → `catch (e) { notice.error("FFmpeg 预设加载失败，请检查服务状态") }`

3. **类型声明**（line 633-635）：
   - `ffmpegPresetOptions` ref 类型从 `{ label: string; value: string }[]` 更新为 group 结构
