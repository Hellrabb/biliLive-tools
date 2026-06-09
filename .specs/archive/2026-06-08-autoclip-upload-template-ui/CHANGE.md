# CHANGE · autoclip-upload-template-ui

> 创建日期：2026-06-07
> 状态：draft

## Why

当前 autoclip 自动上传 B站时，稿件模板（tag、分区、来源、简介等）需要用户在「视频预设」里单独创建一个名为 `autoClip` 的预设来配置。上传模板和 autoclip 预设分属两个不同的设置入口，割裂且不直观。用户需要：

1. 知道这个隐藏约定（videoPreset 命名必须为 `autoClip`）
2. 在两个页面间来回切换配置

**目标**：把 B站稿件模板字段直接集成到 autoclip 预设编辑弹窗的「导出设置」tab 中，让用户在同一页面完成切片→导出→上传的全部配置。

## What

在 `AutoClipPresetDialog.vue` 的「导出设置」tab 中，当 `uploadToBili` 开关打开后，显示精简的 B站稿件模板表单：

- **标题模板**（新增）：支持变量 `{{highlightTitle}}`、`{{roomName}}`、`{{date}}` 等
- **标签** (tag)：动态标签输入
- **投稿分区** (tid)：下拉选择
- **自制/转载** (copyright)：单选
- **转载来源** (source)：文本输入（转载时显示）
- **简介模板** (desc)：textarea，支持变量
- **封面图** (cover)：文本/路径输入
- **禁止转载** (noReprint)：开关（自制时显示）

## 影响面

### 需改动

| 层         | 文件                                                                | 变更                                                                                |
| ---------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 类型       | `packages/types/src/index.ts`                                       | `AutoClipExportConfig` 新增 `biliUpTemplate` 可选字段                               |
| 预设默认值 | `packages/shared/src/presets/autoClipPreset.ts`                     | `AUTO_CLIP_DEFAULT_CONFIG.export` 新增默认值                                        |
| Service    | `packages/shared/src/autoClip/service.ts`                           | `uploadToBili()` 改为读取 autoclip preset 的 `biliUpTemplate`，不再查找 videoPreset |
| 后端路由   | `packages/http/src/routes/`                                         | 可能无需改动（preset CRUD 通用）                                                    |
| 前端 UI    | `packages/app/src/renderer/src/components/AutoClipPresetDialog.vue` | 导出设置 tab 新增 B站模板表单区                                                     |

### 不涉及

- 全局 `biliUpload` 配置（线路、并发、重试等上传基础设施）
- videoPreset 系统本身（仍用于手动上传场景）
- `DEFAULT_BILIUP_CONFIG`（作为 `biliUpTemplate` 默认值的 fallback 仍保留在 videoPreset.ts）
- 录制/弹幕/通知等其他模块

## 范围排除

1. **不做**旧 `autoClip` videoPreset 的自动迁移——用户确认不管旧数据
2. **不做**全部 30+ BiliUpConfig 字段的暴露——只做精简常用字段
3. **不做** videoPreset 系统的重构——videoPreset 仍用于手动上传/其他场景
4. **不做** 封面图片上传功能——只提供路径/文本输入
5. **不做** 分区选择的级联/搜索增强——先用 n-select 基础交互

## 验收线

1. autoclip 预设编辑弹窗的导出设置 tab 中，`uploadToBili` 打开后显示 B站模板表单
2. 标题模板支持变量渲染：`{{highlightTitle}}` 替换为 LLM 生成的高光标题
3. 保存 autoclip 预设后，自动上传使用该模板配置（不再依赖 videoPreset "autoClip"）
4. 未配置模板时，使用合理默认值（tag: ["biliLive-tools"], tid: 138, copyright: 1）
5. 现有不启用 `uploadToBili` 的预设行为不变
6. 现有无 `biliUpTemplate` 字段的旧预设加载不报错（向后兼容）
