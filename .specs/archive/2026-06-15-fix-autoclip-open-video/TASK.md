# TASK — 修复 AutoClip "打开视频" 功能

> Change-ID: `fix-autoclip-open-video`
> 拆解日期: 2026-06-15

## 波次划分

```
Wave 1: T01（类型 + 数据管道）
Wave 2: T02（UI：按钮逻辑 + 播放列表弹窗） depends on T01
```

---

<task id="T01">
  <name>添加 exported_paths 到类型定义和前端数据映射</name>
  <read_files>
    packages/types/src/index.ts
    packages/app/src/renderer/src/pages/AutoClipManagement/Index.vue
    packages/shared/src/db/autoClip.ts
  </read_files>
  <write_files>
    packages/types/src/index.ts
    packages/app/src/renderer/src/pages/AutoClipManagement/Index.vue
  </write_files>
  <action>
    1. 在 `AutoClipClipRow` 类型中添加 `exported_paths?: string | null` 字段
    2. 在 `ClipRow` 接口中添加 `exportedPaths: string[]` 字段
    3. 在 `refreshList()` 的数据映射中（约 line 373-390），解析 `r.exported_paths`（JSON string）→ `exportedPaths: string[]`，null 时回退为 `[]`
  </action>
  <verify>pnpm run build:base</verify>
  <done>✅ 2026-06-15: types 包编译通过；ClipRow.exportedPaths 可用</done>
  <depends_on></depends_on>
</task>

<task id="T02">
  <name>重写"打开视频"按钮：切片播放列表弹窗 + 正确跳转 VideoPlayer</name>
  <read_files>
    packages/app/src/renderer/src/pages/AutoClipManagement/Index.vue
    packages/app/src/renderer/src/utils/pages.ts
  </read_files>
  <write_files>
    packages/app/src/renderer/src/pages/AutoClipManagement/Index.vue
  </write_files>
  <action>
    1. 重写 columns 中"打开视频"按钮的 onClick（约 line 311-322）：
       - 若 `row.status === 'exported'` 且 `row.exportedPaths.length > 0` → 打开播放列表弹窗
       - 否则 → 调用 `toVideoPlayerPage({ videoFilePath: row.video_path })`
    2. 新增播放列表弹窗组件（NModal + NList）：
       - 标题："选择要播放的切片"
       - 列表项显示文件 basename（`path.basename()` 或等价提取）
       - 点击某项 → `toVideoPlayerPage({ videoFilePath: selectedPath })` + 关闭弹窗
       - 支持取消（关闭弹窗不播放）
    3. 添加播放列表弹窗的状态变量（`showPlaylistDialog` + `playlistPaths`）
  </action>
  <verify>
    1. `pnpm run build:base` 编译通过
    2. 手动验证：导出状态切片 → 点击"打开视频" → 弹出列表 → 选中 → 播放
    3. 手动验证：未导出切片 → 点击"打开视频" → 直接打开源视频
  </verify>
  <done>✅ 2026-06-15: 已导出切片弹出播放列表可正常播放；未导出切片打开源视频；编译通过</done>
  <depends_on>T01</depends_on>
</task>
