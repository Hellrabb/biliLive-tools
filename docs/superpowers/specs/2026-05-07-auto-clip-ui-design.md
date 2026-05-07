# autoClip UI 完善 & 扩展功能 — 设计文档

## 概述

在已实现的 autoClip 后端 pipeline 基础上，补齐前端 UI 配置能力，增加全局/单直播间开关控制，并扩展切片管理、审核流程、自动化导出上传闭环等完整功能。

## 前置基础

- autoClip pipeline 已实现（Layer 1 信号检测 + Layer 2 LLM 精排，见 `packages/shared/src/autoClip/`）
- `AutoClipConfig` / `AutoClipSignalConfig` / `AutoClipLLMConfig` 等类型已定义（`packages/types/src/index.ts:1232-1246`）
- `AUTO_CLIP_DEFAULT_CONFIG` 已定义（`packages/shared/src/presets/autoClipPreset.ts`）
- HTTP 手动触发接口已存在：`POST /auto-clip/run`、`GET /auto-clip/result/:id`
- 录制完成后 autoClip 无条件触发（`packages/shared/src/recorder/index.ts:532-566`）

## 核心决策

| 决策点 | 结论 |
|--------|------|
| 开关粒度 | 全局开关 + 单直播间覆盖（沿用 webhook 的 global + rooms 模式） |
| 配置管理 | AutoClipPreset 预设系统（与 DanmuPreset / VideoPreset 同级） |
| 设置入口 | 扩展现有"切片" Tab（CutSetting.vue），新增 autoClip 配置区 |
| 预设编辑 | Tab 分页表单：信号检测 / LLM精排 / 导出设置 / 增强 |
| 切片管理页 | 左侧菜单新增"自动切片"入口，独立页面 |
| 手动触发 | 工具页录播列表 + 切片管理页，两处都有入口 |
| 扩展功能 | 自动导出+上传闭环、切片管理+手动触发、通知+prompt定制+时间窗口、审核流程 |

---

## 1. 数据模型变更

### 1.1 AppConfig 扩展

```typescript
// packages/types/src/index.ts — AppConfig 接口

// videoCut 扩展
videoCut: {
  autoSave: boolean;
  cacheWaveform: boolean;
  // 新增 ↓
  autoClipEnabled: boolean;     // 全局 autoClip 开关，默认 false
  autoClipPresetId: string;     // 全局默认预设ID
  autoClipExport: boolean;      // 自动导出切片视频，默认 false
  autoClipUpload: boolean;      // 自动上传B站，默认 false
  autoClipReviewMode: boolean;  // 审核模式：true=先审核再导出，false=直接导出，默认 true
  autoClipTimeWindow: {         // 运行时间窗口
    enabled: boolean;
    start: string;              // "00:00"
    end: string;                // "23:59"
  };
};
```

### 1.2 AppRoomConfig 扩展

```typescript
// packages/types/src/index.ts — AppRoomConfig 接口

interface AppRoomConfig {
  // ... existing fields ...
  // 新增 ↓
  autoClipEnabled?: boolean;       // 覆盖全局开关
  autoClipPresetId?: string;       // 覆盖全局预设
}
```

`noGlobal` 数组新增允许值为 `"autoClipEnabled"` 和 `"autoClipPresetId"`。

### 1.3 切片结果数据模型（新增数据库表）

```sql
CREATE TABLE IF NOT EXISTS auto_clip_results (
  id TEXT PRIMARY KEY,
  video_path TEXT NOT NULL,
  danmu_path TEXT NOT NULL,
  recorder_id TEXT,          -- 关联的录制器房间号
  preset_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | exported | uploaded | deleted
  highlights TEXT NOT NULL,  -- JSON: HighlightSegment[]
  created_at TEXT NOT NULL,
  exported_at TEXT,
  uploaded_at TEXT,
  exported_paths TEXT,       -- JSON: string[] 导出文件路径列表
  bili_aids TEXT             -- JSON: string[] B站稿件ID列表
);
```

### 1.4 通知配置扩展

```typescript
// AppConfig.notification.task 新增字段
notification: {
  task: {
    // ... existing ...
    autoClip: NotificationTaskStatus[];  // 切片完成通知渠道
  };
}
```

---

## 2. 后端变更

### 2.1 AutoClipPreset 预设 CRUD

`packages/shared/src/presets/autoClipPreset.ts` 的 `AutoClipPreset` 类已继承 `CommonPreset<AutoClipConfig>`，需确认 `performReload` / `performSave` 方法完整性，确保与其他预设类型行为一致。

预设存储：使用 `electron-store` 或 JSON 文件，key 为 `autoClipPresets`。

### 2.2 录制器开关集成

修改 `packages/shared/src/recorder/index.ts` 的 `videoFileCompleted` handler：

```
录制完成
  → 读取 appConfig.recorder.autoClipEnabled (全局)
  → 读取 room 独立配置覆盖
  → 若关闭 → 跳过
  → 若开启 → 读取对应 AutoClipPreset → 执行 pipeline
```

关键变更：
- 移除当前的"无条件执行"逻辑
- `autoClipEnabled` 默认 `false`，用户需主动开启
- 无 preset 绑定时使用 `AUTO_CLIP_DEFAULT_CONFIG`

### 2.3 自动导出 & 上传 Pipeline

在 `packages/shared/src/autoClip/pipeline.ts` 中实现 `exportClips()`：

```
pipeline 完成 → highlights[] 产生
  → 持久化到 auto_clip_results 表 (status=pending|approved)
  → 若 autoClipReviewMode=false:
      → 调用 cut() 导出切片 → FFmpegPreset 压制
      → 可选弹幕压制 (burnDanmaku)
      → 可选上传B站 (复用 upload pipeline)
      → 更新 status: exported/uploaded
      → 发送通知
  → 若 autoClipReviewMode=true:
      → 仅保存结果，等待用户审核
```

### 2.4 切片结果数据库操作

`packages/shared/src/db/autoClip.ts`（新文件）：

```typescript
// 核心操作
saveResult(result: AutoClipResult): void;
getResults(filter?: { status?, recorderId?, limit?, offset? }): AutoClipResult[];
getResultById(id: string): AutoClipResult | undefined;
updateStatus(id: string, status: string): void;
deleteResult(id: string): void;
```

### 2.5 HTTP API 扩展

`packages/http/src/routes/autoClip.ts` 新增路由：

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auto-clip/preset` | 创建/更新预设 |
| GET | `/auto-clip/presets` | 列出所有预设 |
| DELETE | `/auto-clip/preset/:id` | 删除预设 |
| GET | `/auto-clip/clips` | 查询切片结果列表（支持筛选） |
| GET | `/auto-clip/clip/:id` | 获取单条切片详情 |
| POST | `/auto-clip/clip/:id/approve` | 审核通过，触发导出 |
| POST | `/auto-clip/clip/:id/delete` | 删除切片结果 |
| POST | `/auto-clip/clip/:id/re-export` | 重新导出切片 |

---

## 3. 前端变更

### 3.1 设置页 — 切片 Tab 扩展 (`CutSetting.vue`)

在现有"自动保存""缓存波形图数据"下方，新增 autoClip 配置区（用视觉分隔线隔开）：

```
┌─ 手动切片 ─────────────────────────────┐
│ 自动保存                          [ON] │
│ 缓存波形图数据                    [ON] │
├─ 自动切片 (autoClip) ─────────────────┤
│ 启用 autoClip              [OFF⇢ON] ← 全局开关 │
│ 自动导出切片视频            [OFF]      │
│ 自动上传B站                [OFF]      │
│ 审核模式                   [ON]       │
│ 默认预设               [默认预设 ▼]   │
│ 运行时间窗口         [00:00 - 23:59]  │
└───────────────────────────────────────┘
```

### 3.2 直播间弹窗 — autoClip 开关 (`RoomSettingDialog.vue`)

在 `CommonSetting` 下方新增：

```
┌────────────────────────────────────────┐
│ 自动切片                            ...│
│   autoClip                    [ON]     │
│   预设                    [默认预设 ▼] │
└────────────────────────────────────────┘
```

`CommonWebhookSetting.vue` 中需要在 `noGlobal` 可用字段列表中追加 `autoClipEnabled`、`autoClipPresetId`。

### 3.3 预设编辑器 — 弹窗组件 (`components/AutoClipPresetDialog.vue`)

从设置页"切片" Tab 的预设列表点击"编辑"打开。结构：左侧预设列表 + 右侧 Tab 分页编辑表单。

预设列表支持新建、复制、删除，与其他预设（B站上传预设）管理模式一致。

**Tab 1: 信号检测**
```
弹幕密度阈值                    [2.5] x 均值
SC 最低金额触发                 [30] 元
礼物爆发阈值                    [10] 个
礼物统计窗口                    [30] 秒
候选窗口 Padding (前后)      [30] / [30] 秒
最短候选窗口                    [60] 秒
最长候选窗口                    [300] 秒
分析桶宽                        [10] 秒
相邻合并最大间隔                [30] 秒
刷屏检测相似度阈值              [0.8]
```

**Tab 2: LLM 精排**
```
启用 LLM 精排                   [ON]
LLM Provider              [qwen ▼|ollama]
Model ID                        [________]
Max Tokens                      [1000]
保留片段数 (Top-K)              [5]
每视频最大候选数                [15]
弹幕采样上限                    [200]
Prompt 模板                     [_____________] (textarea)
```

**Tab 3: 导出设置**
```
切片格式                   [mp4 ▼|flv]
FFmpeg 预设                [default ▼]
压制弹幕到视频              [OFF]
上传到B站                   [OFF]
保存路径                    [________]
文件命名模板                [{{title}}_{{index}}_{{highlight_name}}]
```

**Tab 4: 增强（预留）**
```
ASR 语音识别增强             [OFF] (灰色，标注"即将上线")
视觉关键帧分析               [OFF] (灰色，标注"即将上线")
```

预设编辑器为弹窗，不占用独立路由。

### 3.4 切片管理页 (`pages/AutoClipManagement/`)

路由：`/autoClip`，在左侧菜单注册"自动切片"项。

页面结构：
```
┌─────────────────────────────────────────────┐
│ 自动切片管理              [+ 手动分析] [刷新] │
├─────────────────────────────────────────────┤
│ [全部(12)] [待审核(3)] [已完成(8)] [失败(1)]  │
├─────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐ │
│ │ 🎯 精彩五杀操作            ⬤ 已完成      │ │
│ │ 2026-05-07 14:30 · 评分 9.2 · 02:15→03:45│ │
│ │ [精彩操作] [团战]                        │ │
│ │ 源: 直播间12345 · 预设: 游戏直播预设      │ │
│ │ [预览] [重新导出] [删除]                 │ │
│ └─────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────┐ │
│ │ 😂 老板大气！              ⬤ 待审核      │ │
│ │ 2026-05-07 12:10 · 评分 7.8 · 00:30→01:20│ │
│ │ [SC爆发] [礼物潮]                        │ │
│ │ [预览] [确认导出] [删除]                 │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

手动分析按钮：打开文件选择对话框（选择视频+弹幕XML），调用 `POST /auto-clip/run`。

预览功能：点击切片项的"预览"按钮，跳转到 `/videoPlayer?source=<videoPath>&start=<startSec>&end=<endSec>`，利用现有 VideoPlayer 页面播放源视频的对应时间段。

### 3.5 工具页录播列表 — "自动分析"按钮

在 `packages/app/src/renderer/src/pages/Tools/pages/Recorder/` 的录制视频列表中，每行增加"自动分析"操作按钮。点击传入该视频路径和对应弹幕 XML 路径，调用 `POST /auto-clip/run`。

### 3.6 左侧导航菜单

```typescript
// packages/app/src/renderer/src/pages/Main/index.vue 的 menuOptions
{
  label: "自动切片",
  key: "AutoClipManagement",
  icon: VideoClip20Regular, // 复用或新增图标
}
```

keep-alive include 列表增加 `"AutoClipManagement"`。

### 3.7 通知配置

`NotificationSetting.vue` 中新增 autoClip 通知勾选项，复用现有通知渠道（server酱/邮件/webhook等），在切片导出完成或审核待处理时发送通知。

---

## 4. 交互流程

### 4.1 自动触发流程（录制完成后）

```
录制完成 (videoFileCompleted)
  → 读取 appConfig.videoCut.autoClipEnabled
    → false: 结束
    → true: 读取房间独立配置
      → 检查时间窗口
        → 窗口外: 结束
        → 窗口内: 读取 AutoClipPreset → 执行 pipeline
          → highlights 产生 → 持久化 DB
          → reviewMode?
            → true: 存入 pending 状态，发送"待审核"通知
            → false: 自动导出→压制→(可选)上传，更新状态，发送完成通知
```

### 4.2 手动触发流程

```
用户点击"自动分析" / "手动分析"
  → 获取视频+弹幕路径
  → 选择/使用默认 AutoClipPreset
  → 执行 pipeline
  → 跳转到切片管理页查看结果
```

### 4.3 审核流程

```
切片管理页 → 待审核列表
  → 用户预览（点击播放，带时间轴标记）
  → 确认导出：触发 cut() 导出 + 可选上传
  → 删除：移除该切片结果
```

---

## 5. 实现阶段划分

鉴于范围较大，分 4 个阶段交付：

### Phase 1: 开关 + 预设 UI（核心配置能力）
- AppConfig/AppRoomConfig 类型扩展
- 录制器开关集成（默认 false）
- CutSetting.vue 扩展
- RoomSettingDialog.vue 扩展
- AutoClipPreset 预设编辑器页面
- 预设 CRUD API
- 切片结果数据库表

### Phase 2: 自动导出 & 上传闭环
- `exportClips()` 实现
- 自动导出+压制弹幕
- 自动上传B站（复用现有 pipeline）
- 切片结果持久化
- 通知配置 & 触发

### Phase 3: 切片管理页
- 切片管理页面（列表+筛选+状态）
- 审核流程（预览/确认/删除）
- 手动触发按钮（工具页+管理页）
- 左侧导航菜单

### Phase 4: 高级功能
- 自定义 LLM prompt 模板
- 运行时间窗口
- 重新导出功能
- ASR/视觉增强入口（UI 占位）

---

## 6. 安全 & 边界考虑

- **autoClipEnabled 默认 false**：用户必须主动开启，避免旧用户被意外触发
- **时间窗口检查**：仅有配置的时间窗口内才执行 autoClip，避免与其他任务抢占 CPU/IO
- **LLM 调用限制**：`maxCandidatesPerVideo` 和 `topK` 限制 LLM 调用次数，防止 API 费用失控
- **导出文件路径校验**：`exportClips` 写入路径前验证不超出 `savePath` 范围
- **通知仅在状态变更时发送**：防止重复通知

---

## 7. 测试策略

| 层 | 测试内容 |
|----|---------|
| 类型 | `AppConfig`/`AppRoomConfig` 扩展字段类型检查 |
| 预设 CRUD | 创建/读取/更新/删除 AutoClipPreset 单元测试 |
| 开关逻辑 | 录制完成后跳过/执行的集成测试 |
| 导出 pipeline | `exportClips()` 各路径（导出/压制/上传）单元测试 |
| DB 操作 | `auto_clip_results` 增删改查单元测试 |
| API | HTTP routes 集成测试 |
| UI | Vue 组件渲染测试（CutSetting, RoomSettingDialog 扩展部分） |
