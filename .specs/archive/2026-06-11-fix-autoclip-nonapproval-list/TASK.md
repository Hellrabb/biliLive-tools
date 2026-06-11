# TASK — fix-autoclip-nonapproval-list

> 路径：最短（纯 bug 修复）
> 状态：已完成

---

## 波次

```
Wave 1 (parallel): T01[P], T02[P], T03[P]  — 互不冲突，可并行
```

---

<task id="T01" parallel="true">
  <name>添加 "已批准" 状态筛选 tab</name>
  <read_files>
    packages/app/src/renderer/src/pages/AutoClipManagement/Index.vue
  </read_files>
  <write_files>
    packages/app/src/renderer/src/pages/AutoClipManagement/Index.vue
  </write_files>
  <action>
    在 AutoClipManagement 页面的状态筛选 radio-group 中，
    于 "待审核" 和 "导出中" 之间插入 value="approved" 的 radio-button（标签 "已批准"），
    绑定 counts.approved 显示数量。
  </action>
  <verify>npx vue-tsc --noEmit --project packages/app/tsconfig.json</verify>
  <done>radio-group 包含 7 个选项（全部/待审核/已批准/导出中/已完成/已上传/失败），类型检查通过</done>
  <depends_on></depends_on>
</task>

<task id="T02" parallel="true">
  <name>添加 onActivated 钩子解决 keep-alive 数据过期</name>
  <read_files>
    packages/app/src/renderer/src/pages/AutoClipManagement/Index.vue
  </read_files>
  <write_files>
    packages/app/src/renderer/src/pages/AutoClipManagement/Index.vue
  </write_files>
  <action>
    在 AutoClipManagement 页面添加 onActivated(() => refreshList())，
    确保从 keep-alive 缓存恢复时自动刷新数据。
  </action>
  <verify>npx vue-tsc --noEmit --project packages/app/tsconfig.json</verify>
  <done>页面从其他 tab 切回时自动刷新切片列表；类型检查通过</done>
  <depends_on></depends_on>
</task>

<task id="T03" parallel="true">
  <name>扩展导出按钮支持 approved 状态 + 新增 reExportClip API</name>
  <read_files>
    packages/app/src/renderer/src/pages/AutoClipManagement/Index.vue
    packages/app/src/renderer/src/apis/presets/autoClip.ts
  </read_files>
  <write_files>
    packages/app/src/renderer/src/pages/AutoClipManagement/Index.vue
    packages/app/src/renderer/src/apis/presets/autoClip.ts
  </write_files>
  <action>
    1. 在 autoClip.ts 新增 reExportClip(clipId) 函数，封装 POST /auto-clip/clips/:id/re-export
    2. 在 AutoClipManagement 中将 approveClip 重命名为 exportClip
    3. 扩展按钮条件：row.status === "pending" || row.status === "approved"
    4. approved 状态调用 reExportClip，按钮文字显示 "重新导出"
    5. pending 状态保持原有 approveAndExport 调用，按钮文字 "确认导出"
  </action>
  <verify>npx vue-tsc --noEmit --project packages/app/tsconfig.json</verify>
  <done>approved 状态 clip 显示 "重新导出" 按钮，点击后正常触发导出；类型检查通过</done>
  <depends_on></depends_on>
</task>
