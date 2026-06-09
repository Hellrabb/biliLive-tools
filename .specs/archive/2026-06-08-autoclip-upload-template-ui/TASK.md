# TASK · autoclip-upload-template-ui

> 关联：`REQUIREMENT.md` / `DESIGN.md` / `UI-DESIGN.md`
> 总任务数：5 | 波次：3

---

## 波次划分

```
Wave 1 (parallel): T01[P], T02[P]     ← 无依赖，类型定义 + 工具函数
Wave 2:            T03                  ← depends on T01（类型就绪后改默认值）
Wave 3 (parallel): T04[P], T05[P]      ← depends on T01,T02,T03（全就绪后改 service + UI）
```

---

<task id="T01" parallel="true">
  <name>定义 BiliUpTemplateConfig 类型</name>
  <read_files>
    packages/types/src/index.ts
  </read_files>
  <write_files>
    packages/types/src/index.ts
  </write_files>
  <action>
    1. 新增 `BiliUpTemplateConfig` 接口：精简版 B站稿件模板，字段与 BiliupConfig 同名一致
       字段：titleTemplate(string), descTemplate(string), tag(string[]), tid(number), copyright(1|2), source?(string), cover?(string), noReprint?(0|1)
    2. 在 `AutoClipExportConfig` 中新增可选字段 `biliUpTemplate?: BiliUpTemplateConfig`
    3. 不要删除/修改 BiliupConfig 的任何字段
  </action>
  <verify>cd packages/types && pnpm run build</verify>
  <done>types 包构建成功；AutoClipExportConfig 包含 biliUpTemplate 可选字段</done>
  <depends_on></depends_on>
</task>

<task id="T02" parallel="true">
  <name>新增模板变量渲染工具 templateRenderer.ts</name>
  <read_files>
    packages/shared/src/utils/webhook.ts
  </read_files>
  <write_files>
    packages/shared/src/autoClip/templateRenderer.ts
  </write_files>
  <action>
    1. 新建 `packages/shared/src/autoClip/templateRenderer.ts`
    2. 导出 `applyTemplateVariables(template: string, vars: Record<string, string>): string`
       - 用 `String.replaceAll('{{key}}', value ?? '')` 替换
       - 未匹配的 `{{unknown}}` 原样保留
    3. 导出 `TemplateContext` 接口：{ highlightTitle, roomName, date, uploadDate }
    4. 参考 webhook.ts:formatPartTitle() 的 replaceAll 模式，不引入 ejs
  </action>
  <verify>cd packages/shared && npx tsc --noEmit src/autoClip/templateRenderer.ts</verify>
  <done>templateRenderer.ts 编译通过，函数签名正确</done>
  <depends_on></depends_on>
</task>

<task id="T03">
  <name>更新 AUTO_CLIP_DEFAULT_CONFIG 默认值</name>
  <read_files>
    packages/types/lib/index.d.ts
    packages/shared/src/presets/autoClipPreset.ts
  </read_files>
  <write_files>
    packages/shared/src/presets/autoClipPreset.ts
  </write_files>
  <action>
    1. 在 `AUTO_CLIP_DEFAULT_CONFIG.export` 中新增 `biliUpTemplate` 默认值：
       - titleTemplate: "{{highlightTitle}}"
       - descTemplate: ""
       - tag: ["biliLive-tools"]
       - tid: 138
       - copyright: 1
       - source: undefined
       - cover: ""
       - noReprint: 0
    2. 确保类型与 T01 的 BiliUpTemplateConfig 一致
  </action>
  <verify>cd packages/shared && npx tsc --noEmit src/presets/autoClipPreset.ts</verify>
  <done>默认配置编译通过；新建 autoclip 预设导出设置默认值正确</done>
  <depends_on>T01</depends_on>
</task>

<task id="T04" parallel="true">
  <name>改写 uploadToBili() 数据源 + 封面自动提取</name>
  <read_files>
    packages/shared/src/autoClip/service.ts
    packages/shared/src/autoClip/templateRenderer.ts
    packages/shared/src/autoClip/frameSampler.ts
    packages/shared/src/presets/videoPreset.ts
    packages/shared/src/task/bili.ts
    packages/shared/src/config.ts
  </read_files>
  <write_files>
    packages/shared/src/autoClip/service.ts
  </write_files>
  <action>
    1. 修改 `uploadToBili()` 方法签名，新增 `presetConfig: AutoClipConfig` 参数
    2. 数据源切换：
       - 读取 `presetConfig.export.biliUpTemplate`（若无，回退字段级默认值同 T03）
       - 删除 `container.resolve("videoPreset")` 和 `presets.find(p => p.name === "autoClip")` 逻辑
       - 仍保留 `DEFAULT_BILIUP_CONFIG` import 作为字段级 fallback 来源
    3. 模板渲染：
       - 对每条 highlight，用 `applyTemplateVariables()` 渲染 titleTemplate 和 descTemplate
       - 构建 TemplateContext（从 highlight.title / recorder name / 日期获取）
       - 渲染后 title 做 `trim().slice(0, 80)` 截断
    4. 封面自动提取：
       - 若 `biliUpTemplate.cover` 为空 → 从 `highlight.bestRange` 中点时间戳调 `sampleFrames()` 提取一帧
       - base64 → 写入 `userDataPath + '/cover/auto_clip_' + hash + '.jpg'`
       - 提取失败 → 不上传封面，不中断投稿
       - 若手动指定了 cover 路径 → 跳过自动提取
    5. 保持 `biliApi.addMedia()` 调用签名不变，只是传入的 config 来源变了
  </action>
  <verify>cd packages/shared && npx tsc --noEmit src/autoClip/service.ts</verify>
  <done>
    编译通过；
    uploadToBili 读 autoclip preset 不查 videoPreset；
    模板变量正确替换；
    封面自动提取逻辑正确（cover 为空时提取，失败降级）
  </done>
  <depends_on>T01, T02, T03</depends_on>
</task>

<task id="T05" parallel="true">
  <name>AutoClipPresetDialog 导出设置 tab 新增 B站模板表单</name>
  <read_files>
    packages/app/src/renderer/src/components/AutoClipPresetDialog.vue
    packages/app/src/renderer/src/components/DynamicTags.vue
    packages/app/src/renderer/src/components/BiliSetting.vue
  </read_files>
  <write_files>
    packages/app/src/renderer/src/components/AutoClipPresetDialog.vue
  </write_files>
  <action>
    按 UI-DESIGN.md 2.2 字段清单，在「导出设置」tab 的 `uploadToBili` 开关下方新增条件表单区：
    1. `v-if="editingPreset.config.export.uploadToBili"` 包裹新增字段
    2. 字段列表：
       - 标题模板：n-input，v-model="editingPreset.config.export.biliUpTemplate.titleTemplate"
       - 标签：DynamicTags 组件（从 ./DynamicTags.vue import），绑定 biliUpTemplate.tag
       - 投稿分区：n-cascader，options 从 localStorage 'areaData' 读取，绑定 biliUpTemplate.tid
       - 自制/转载：n-radio-group，两个 n-radio（value 1/2）
       - 禁止转载：n-switch（v-if="copyright===1"）
       - 转载来源：n-input（v-if="copyright===2"）
       - 简介模板：n-input type="textarea"，绑定 biliUpTemplate.descTemplate
       - 封面图：n-input，placeholder="留空自动提取高光帧作为封面"
    3. 模板字段下方统一显示变量提示 feedback
    4. 在 script 中：
       - import DynamicTags
       - 初始化 areaData ref（从 localStorage 读）
       - 确保 editingPreset deep clone 时包含 biliUpTemplate 默认值（使用可选链 ?? 回退到 T03 默认值）
    5. 不引入新 CSS，全用 Naive UI 内联 style
  </action>
  <verify>cd packages/app && npx vue-tsc --noEmit src/renderer/src/components/AutoClipPresetDialog.vue</verify>
  <done>
    编译通过；
    uploadToBili 打开后表单字段正常显示；
    关闭后隐藏；
    copyright 切换时禁止转载/转载来源正确显隐；
    分区下拉列表正常加载；
    DynamicTags 正常添加/删除标签
  </done>
  <depends_on>T01, T03</depends_on>
</task>
