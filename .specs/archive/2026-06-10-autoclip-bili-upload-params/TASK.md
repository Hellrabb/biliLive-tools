# TASK — autoclip-bili-upload-params

> 拆自 CHANGE.md（最短路径，跳过 REQUIREMENT + DESIGN）
> 变更范围：补齐 `BiliUpTemplateConfig` → 与 `BiliupConfig` 字段对齐 + JSDoc + 前端 tooltip
>
> **状态**：✅ 全部完成 (2026-06-10)
>
> - [x] T01 — 扩展 BiliUpTemplateConfig 类型 + JSDoc ✅
> - [x] T02 — 更新 AUTO_CLIP_DEFAULT_CONFIG + service.ts 透传 ✅
> - [x] T03 — 前端 AutoClipPresetDialog 补充字段 tooltip ✅

## 波次划分

```
Wave 1:         T01 (类型定义 — 所有下游依赖)
Wave 2 [P]:     T02 (shared 默认值 + service 透传), T03 (前端 tooltip)
```

---

<task id="T01" parallel="false">
  <name>扩展 BiliUpTemplateConfig 类型 + JSDoc</name>
  <read_files>
    packages/types/src/index.ts (BiliupConfig L1033-1088, BiliUpTemplateConfig L1292-1309)
  </read_files>
  <write_files>
    packages/types/src/index.ts
  </write_files>
  <action>
    将 BiliUpTemplateConfig 从 8 字段扩展为覆盖 BiliupConfig 全部字段（全部 optional）。
    每个字段加 JSDoc 注释（约束、默认值、格式说明），与 BiliupConfig 的注释风格对齐。
    保留 titleTemplate/descTemplate 字段（autoclip 特有，支持变量替换），
    新增字段与 BiliupConfig 中的对应字段注释一致。
    新增的 BiliupConfig 字段列表：
    dolby, hires, dynamic, watermark, openElec, closeDanmu, closeReply,
    selectiionReply, autoComment, commentTop, comment, no_disturbance,
    recreate, dtime, is_only_self, space_hidden, seasonId, sectionId,
    topic_name, mission_id, human_type2, partTitleTemplate
  </action>
  <verify>cd packages/types && pnpm run build</verify>
  <done>BiliUpTemplateConfig 包含 BiliupConfig 所有字段（optional）+JSDoc；types 包构建通过</done>
  <depends_on></depends_on>
</task>

<task id="T02" parallel="true">
  <name>更新 AUTO_CLIP_DEFAULT_CONFIG + service.ts 透传</name>
  <read_files>
    packages/types/src/index.ts (新版 BiliUpTemplateConfig)
    packages/shared/src/presets/autoClipPreset.ts
    packages/shared/src/presets/videoPreset.ts (DEFAULT_BILIUP_CONFIG)
    packages/shared/src/autoClip/service.ts (uploadToBili L395-481)
  </read_files>
  <write_files>
    packages/shared/src/presets/autoClipPreset.ts
    packages/shared/src/autoClip/service.ts
  </write_files>
  <action>
    1. autoClipPreset.ts: AUTO_CLIP_DEFAULT_CONFIG.export.biliUpTemplate 新增字段补 DEFAULT_BILIUP_CONFIG 的默认值
    2. service.ts uploadToBili(): 从 tpl 解构新增字段，透传到 biliApi.addMedia() 的第二个参数。
       注意：模板变量字段 (titleTemplate/descTemplate) 不走 DEFAULT_BILIUP_CONFIG fallback，
       其他新增字段在 tpl 未设置时 fallback 到 DEFAULT_BILIUP_CONFIG 对应值。
  </action>
  <verify>cd packages/shared && pnpm run build</verify>
  <done>新增字段全部透传到 addMedia()；shared 包构建通过</done>
  <depends_on>T01</depends_on>
</task>

<task id="T03" parallel="true">
  <name>前端 AutoClipPresetDialog 补充字段 tooltip</name>
  <read_files>
    packages/types/src/index.ts (新版 BiliUpTemplateConfig 字段和 JSDoc)
    packages/app/src/renderer/src/components/AutoClipPresetDialog.vue
    packages/app/src/renderer/src/apis/presets/autoClip.ts
  </read_files>
  <write_files>
    packages/app/src/renderer/src/components/AutoClipPresetDialog.vue
  </write_files>
  <action>
    在 AutoClipPresetDialog.vue 的导出设置 tab 中，为 B站上传相关表单字段（tag/tid/copyright/source/cover/noReprint
    及新增的 dolby/hires/closeDanmu/closeReply/dynamic/dtime 等）添加 tooltip 或说明文字。
    使用 Naive UI 的 n-tooltip 或 n-text（depth:2/3 的灰色说明文字）展示 JSDoc 中的约束信息。
    高频字段优先展示 tooltip，低频字段可用折叠面板（n-collapse）收纳。
  </action>
  <verify>cd packages/app && pnpm run build</verify>
  <done>B站上传字段有可读的 tooltip/说明；app 构建通过</done>
  <depends_on>T01</depends_on>
</task>
