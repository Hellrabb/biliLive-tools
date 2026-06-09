# REQUIREMENT · autoclip-upload-template-ui

> 状态：draft
> 关联：`CHANGE.md`

## 用户故事

**作为** 直播切片创作者
**我想** 在 autoclip 预设编辑页面直接配置 B站稿件模板（标题/标签/分区/简介）
**以便** 不用切换页面、不用记住 "videoPreset 必须命名为 autoClip" 的隐藏约定，在一个地方完成切片→导出→上传的全部配置

---

## 验收准则

### AC-1：导出设置 tab 显示 B站模板表单

**Given** 用户打开 autoclip 预设编辑弹窗，切换到「导出设置」tab
**When** 用户打开「上传到B站」开关
**Then** 开关下方出现 B站稿件模板表单区域，包含以下字段：

| 字段                  | 类型     | 说明                               |
| --------------------- | -------- | ---------------------------------- |
| 标题模板              | 文本输入 | 支持变量，placeholder 提示可用变量 |
| 标签 (tag)            | 动态标签 | 添加/删除，最多 10 个              |
| 投稿分区 (tid)        | 下拉选择 | 复用现有分区列表                   |
| 自制/转载 (copyright) | 单选     | 自制 / 转载                        |
| 转载来源 (source)     | 文本输入 | copyright=转载 时显示              |
| 禁止转载 (noReprint)  | 开关     | copyright=自制 时显示              |
| 简介模板 (desc)       | 多行文本 | 支持变量                           |
| 封面图路径 (cover)    | 文本输入 | 可选                               |

**And** 关闭「上传到B站」开关时，模板表单隐藏

### AC-2：标题模板变量

**Given** 用户在「标题模板」输入框中输入 `{{highlightTitle}} - {{roomName}}【直播切片】`
**When** autoclip 完成切片并触发自动上传
**Then** 系统将 `{{highlightTitle}}` 替换为 LLM 生成的高光标题，`{{roomName}}` 替换为录制房间名/主播名
**And** 若变量对应的值不存在（如无 roomName），替换为空字符串

支持变量列表：
| 变量 | 来源 | 示例值 |
|------|------|--------|
| `{{highlightTitle}}` | LLM 高光标题 | "精彩五杀操作" |
| `{{roomName}}` | 录制直播间名称 | "某某的直播间" |
| `{{date}}` | 录制日期 (YYYY-MM-DD) | "2026-06-07" |
| `{{uploadDate}}` | 上传日期 (YYYY-MM-DD) | "2026-06-07" |

### AC-3：简介模板变量

**Given** 用户在「简介模板」中输入 `本视频由AI自动切片生成\n直播间：{{roomName}}\n日期：{{date}}`
**When** 触发上传
**Then** 变量被替换为实际值
**And** 支持与标题相同的变量集
**And** `\n` 渲染为换行

### AC-4：模板字段默认值

**Given** 用户新建 autoclip 预设，未手动配置 B站模板
**When** 打开「上传到B站」开关
**Then** 表单显示默认值：

- 标题模板：`{{highlightTitle}}`
- 标签：`["biliLive-tools"]`
- 分区：`138`（生活·日常）
- 自制/转载：自制
- 简介模板：空
- 其他字段：空/默认

### AC-5：保存与上传链路

**Given** 用户在 autoclip 预设中配置了 B站模板并保存
**When** autoclip 服务检测到 `export.uploadToBili` 为 true，触发上传
**Then** `uploadToBili()` 方法从 `presetConfig.export.biliUpTemplate` 读取模板配置
**And** 不再查找 videoPreset "autoClip"
**And** 模板字段合并到 `biliApi.addMedia()` 的参数中
**And** 若 `biliUpTemplate` 未配置（旧预设），回退使用 `DEFAULT_BILIUP_CONFIG`

### AC-6：旧预设向后兼容

**Given** 系统中存在执行 up 升级前创建的 autoclip 预设（`export` 中无 `biliUpTemplate` 字段）
**When** 打开该预设的编辑弹窗，切换到「导出设置」tab，打开「上传到B站」
**Then** 表单不报错，显示默认值（同 AC-4）
**And** 上传时使用默认配置，功能正常

### AC-8：封面自动提取

**Given** 用户在 autoclip 预设中启用 `uploadToBili`，且未手动指定封面路径
**When** 切片导出完成，触发 B站上传
**Then** 系统从 `highlight.bestRange` 中间时间点提取一帧作为封面
**And** 提取的封面保存到 `userDataPath/cover/auto_clip_{hash}.jpg`
**And** 若提取失败（如 ffmpeg 不可用），上传不中断，仅无封面

### AC-7：分区列表复用

**Given** 用户在 B站模板表单中选择「投稿分区」
**When** 点击分区下拉
**Then** 显示与现有「B站设置」/「视频预设」相同的分区列表（从 B站 API 或内置列表获取）
**And** 默认选中 `138`（生活·日常）

---

## 范围切分

### v1（本次必做）

- `AutoClipExportConfig` 新增 `biliUpTemplate` 可选字段（精简版 B种UpConfig）
- `AutoClipPresetDialog.vue` 导出设置 tab 新增条件显隐的模板表单
- `service.ts:uploadToBili()` 改为读取 autoclip preset 中的模板
- 标题模板变量解析（`{{highlightTitle}}` / `{{roomName}}` / `{{date}}` / `{{uploadDate}}`）
- 简介模板变量解析（同变量集）
- 向后兼容：无 `biliUpTemplate` 时回退默认值

### v2（下次）

- 封面图片上传（从本地文件选择，而非手工填路径）
- 标题模板预览（输入模板后实时预览替换结果）
- 分区级联搜索（输入关键词过滤分区）
- 定时发布 (dtime) 支持
- 自定义变量（用户定义 key=value）

### out（永远不做）

- 全部 30+ BiliUpConfig 字段暴露（Dolby/Hi-Res/二创/充电面板等保持不可配）
- videoPreset "autoClip" 自动迁移到新的 `biliUpTemplate`
- 多稿件模板（一个预设多个模板方案）

---

## 非功能性需求

| 维度     | 要求                                                          |
| -------- | ------------------------------------------------------------- |
| 兼容性   | 旧预设（无 `biliUpTemplate` 字段）加载不报错，自动填充默认值  |
| 性能     | 分区列表加载不阻塞弹窗打开（异步/缓存）                       |
| 可用性   | 标题模板输入框旁显示可用变量 placeholder 提示                 |
| 安全性   | desc/title 模板变量注入攻击防护（变量值做 HTML/特殊字符转义） |
| 可访问性 | 无特殊要求                                                    |
