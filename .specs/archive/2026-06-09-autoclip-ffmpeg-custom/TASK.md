# TASK: AutoClip FFmpeg 预设参数预览

- **Change ID**: autoclip-ffmpeg-custom
- **关联**: `@.specs/autoclip-ffmpeg-custom/REQUIREMENT.md`、`@.specs/autoclip-ffmpeg-custom/DESIGN.md`、`@.specs/autoclip-ffmpeg-custom/UI-DESIGN.md`

---

## 波次划分

```
Wave 1 (parallel): T01[P], T02[P]
Wave 2:            T03       (depends on T01)
```

---

## 任务清单

```xml
<task id="T01" parallel="true" status="done">
  <name>切换 API 到 /ffmpeg/options + 修复静默吞错</name>
  <read_files>
    packages/app/src/renderer/src/components/AutoClipPresetDialog.vue
    packages/app/src/renderer/src/apis/presets/ffmpeg.ts
    packages/app/src/renderer/src/hooks/useNotice.ts
  </read_files>
  <write_files>
    packages/app/src/renderer/src/components/AutoClipPresetDialog.vue
  </write_files>
  <action>
    1. 修改 loadFfmpegPresets()（line 661-670）：
       - 从 ffmpegPresetApi.list() 改为 ffmpegPresetApi.options()
       - API 返回格式：[{value, label, children: [{value, label, config}]}]
       - 前端映射：每个 group 加 type: 'group'（Naive UI n-select 需要），children 映射为 {label: child.label, value: child.value}
       - 保存完整 config 对象到 option 上（如 option.config = child.config），供 T03 使用
       - ffmpegPresetOptions ref 类型扩展为包含 group 结构
    2. 修改 catch 块（line 668）：从静默注释改为 notice.error("FFmpeg 预设加载失败，请检查服务状态")
    3. 注意：ffmpegPresetOptions 已用于模板的 n-select :options 绑定，需确保新格式兼容
  </action>
  <verify>pnpm run typecheck && pnpm run --filter biliLive-tools build:webui</verify>
  <done>AC-1（自定义预设出现在下拉分组中）、AC-2（下拉显示分组）、AC-6（加载失败有通知）</done>
  <depends_on></depends_on>
</task>

<task id="T02" parallel="true" status="done">
  <name>Home 页面支持 ?tab= 查询参数激活指定 tab</name>
  <read_files>
    packages/app/src/renderer/src/pages/Home/index.vue
    packages/app/src/renderer/src/routers/index.ts
  </read_files>
  <write_files>
    packages/app/src/renderer/src/pages/Home/index.vue
  </write_files>
  <action>
    在 Home/index.vue 的 script setup 中：
    1. import { useRoute } from "vue-router"
    2. 添加 watchEffect：读取 route.query.tab，如果存在且匹配某个 n-tab-pane name，则设置 activeTab ref
    3. n-tabs 绑定 v-model:value 到一个 ref（如 activeTab），默认值与现有行为一致
    4. 如果当前无 query.tab，不走覆盖逻辑（保留 n-tabs 默认 tab）
    5. 支持的 tab 值：ffmpeg-setting / common-setting / upload-setting / danmukufactory-setting
  </action>
  <verify>pnpm run typecheck</verify>
  <done>AC-5 前置条件：router.push({ path: '/home', query: { tab: 'ffmpeg-setting' } }) 能正确激活 FFmpeg 设置 tab</done>
  <depends_on></depends_on>
</task>

<task id="T03" parallel="false" status="done">
  <name>参数预览卡片 + encoder 自动同步 + 跳转链接</name>
  <read_files>
    packages/app/src/renderer/src/components/AutoClipPresetDialog.vue
    packages/app/src/renderer/src/apis/presets/ffmpeg.ts
    packages/shared/src/enum.js（nvencPresets / qsvPresets / amfPresets 枚举）
  </read_files>
  <write_files>
    packages/app/src/renderer/src/components/AutoClipPresetDialog.vue
  </write_files>
  <action>
    在 AutoClipPresetDialog.vue 的"导出设置"tab 中（FFmpeg 预设下拉下方）：

    1. **计算属性 selectedPresetConfig**（computed）：
       - 监听 editingPreset.config.export.ffmpegPresetId
       - 从 ffmpegPresetOptions 中查找匹配的 option，提取 option.config 对象
       - 返回 null（未选中）或 config 对象

    2. **encoder 自动同步**（watch）：
       - watch selectedPresetConfig：如果非 null，提取 config.encoder 写入 editingPreset.value.config.export.encoder
       - 单向同步，不清空预设选择（用户手动改 encoder 后保持偏离态，见 DESIGN D3）

    3. **参数预览卡片**（模板）：
       - v-if="selectedPresetConfig" 渲染 n-descriptions
       - label-placement="left", :column="1", size="small", bordered
       - 6 行：编码器、码率控制、码率(kbps)、Preset（含 label 映射如 p3→"p3 (fast)"）、CRF、10-bit（是/否）
       - preset label 映射：从 enum.js import 的 nvencPresets/qsvPresets/amfPresets 中查找 value 匹配 label
       - 码率显示：config.bitrate + " kbps"
       - 10-bit 显示：config.bit10 ? "是" : "否"

    4. **跳转链接**（模板，预览卡片底部）：
       - 自定义预设（ffmpegPresetId 不以 "b_" 开头）：n-button text type="info" @click="router.push({ path: '/home', query: { tab: 'ffmpeg-setting' } })"
         - 文案："编辑此预设 →"
       - 内置预设（ffmpegPresetId 以 "b_" 开头）：n-text depth="3"
         - 文案："内置预设 · 在预设管理中复制后编辑"
       - import { useRouter } from "vue-router"; const router = useRouter();

    5. **Import 补充**：
       - 确保 NDescriptions, NDescriptionsItem, NText 已在 script setup 的 Naive UI import 中（或由 unplugin-auto-import 自动处理）
  </action>
  <verify>pnpm run typecheck && pnpm run --filter biliLive-tools build:webui</verify>
  <done>AC-3（参数预览）、AC-4（encoder 同步）、AC-5（跳转链接）</done>
  <depends_on>T01</depends_on>
</task>
```

---

## 状态字段说明

- `status="pending"` — 未开始
- `status="in_progress"` — 进行中
- `status="done"` — 已完成（verify 通过）
- `status="blocked"` — 阻塞

---

## 阻塞日志

（空）

---

## Fix 任务（来自 REVIEW / INTEGRATION）

```xml
<!-- 占位 -->
```
