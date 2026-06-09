# T03 完成摘要 — 参数预览 + encoder 同步 + 跳转链接

- **AC 覆盖**：AC-3、AC-4、AC-5
- **修改文件**：`packages/app/src/renderer/src/components/AutoClipPresetDialog.vue`
- **依赖**：T01
- **验证**：`typecheck` 通过（`node` + `web`）

## 改动

1. **新增 imports**：
   - `nvencPresets`, `qsvPresets`, `amfPresets`, `amfAv1Presets`, `cpuPresets`, `videoToolBoxPresets` from `@biliLive-tools/shared/enum.js`
   - `useRouter` from `vue-router`

2. **`selectedPresetConfig` computed**（line 699-706）：
   - 从 `editingPreset.config.export.ffmpegPresetId` 获取当前选中预设 ID
   - 遍历 `ffmpegPresetOptions` 的 group children 查找匹配 config

3. **`getPresetLabel()` helper**（line 708-716）：
   - 根据 encoder 名前缀（nvenc/qsv/amf/videotoolbox/cpu）选择对应枚举
   - 匹配 preset value → 返回 `"p3 (fast)"` 格式标签

4. **encoder 自动同步**（line 718-721）：
   - `watch(selectedPresetConfig, ...)` → 提取 `cfg.encoder` 写入 `editingPreset.config.export.encoder`
   - 单向同步（预设 → encoder），不干预用户手动修改

5. **参数预览模板**（line 258-291）：
   - `v-if="selectedPresetConfig"` 条件渲染
   - `<n-descriptions label-placement="left" :column="1" size="small" bordered>`
   - 6 行：编码器 / 码率控制 / 码率(kbps) / Preset（label映射） / CRF / 10-bit

6. **跳转链接**（line 285-292）：
   - 自定义预设：`<n-button text type="info" @click="router.push(...)">编辑此预设 →</n-button>`
   - 内置预设（ID 以 "b\_" 开头）：`<n-text depth="3">内置预设 · 在预设管理中复制后编辑</n-text>`

## 关键行为

| 场景             | 行为                         |
| ---------------- | ---------------------------- |
| 选中预设         | preview 出现 + encoder 同步  |
| 清空预设         | preview 消失 + encoder 保持  |
| 手动改 encoder   | 预设保持选中，preview 不消失 |
| 选内置预设 (b\_) | "内置预设·复制后编辑" 提示   |
| 选自定义预设     | "编辑此预设 →" 跳转链接      |
