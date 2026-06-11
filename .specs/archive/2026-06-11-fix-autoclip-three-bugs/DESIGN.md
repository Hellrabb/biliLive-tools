# DESIGN: fix-autoclip-three-bugs

- **Change ID**: fix-autoclip-three-bugs
- **关联**: `REQUIREMENT.md` / `CHANGE.md`

---

## 0. 架构级变更预检

已跑过 0-change，CHANGE.md 有范围描述。本次为 bugfix，不涉及：拆模块 / 换数据库 / 改鉴权方案 / 公共契约变更 / 容量边界 / 跨服务编排。直接进入设计。

## 0. 技术栈选定

> 沿用项目栈：TypeScript + better-sqlite3 + ffmpeg (fluent-ffmpeg) + @renmu/bili-api。无新增依赖。

## 1. 决策清单

### D1 · 每日批量上传使用内存 Map 而非 DB 表

- **决策**: 使用 `private dailyUploadAids = new Map<string, number>()` 追踪每日投稿 AID，key = `${recorderId}_${date}`
- **理由**: 单进程应用，AID 仅在同一次会话内有效（重启后 AID 不会变）。内存 Map 足够，避免新增 DB schema
- **代价**: 进程重启后 AID 丢失，同天后续切片会创建新投稿（而非追加）。低概率场景（上传间隔期重启），见 REVIEW R6
- **替代方案**: DB 表持久化。更健壮但引入 schema 变更和迁移。排入 v2

### D2 · accurateSeek 使用特性开关（默认 false）而非全局替换

- **决策**: `FfmpegOptions.accurateSeek?: boolean`，默认 undefined（falsy），仅 autoclip export 显式设为 `true`
- **理由**: 全局替换会破坏录制剪辑的 `addTimestamp` 功能（依赖 `-copyts` 保持时间戳）。特性开关隔离新旧行为，零风险
- **代价**: `accurateSeek` 与 `addTimestamp` 互斥，JSDoc 已声明。autoclip 不使用 `addTimestamp`，无冲突
- **替代方案**: 全局移除 `-copyts`。破坏现有功能，不可接受

### D3 · {{title}} 复用录制系统的语义（直播标题）

- **决策**: `TemplateContext.title` 从 `pasrseMetadata().title` 提取，与 webhook `formatTitle` 的 `{{title}}` 语义一致（均代表直播标题）
- **理由**: 用户期望 `{{title}}` 在 autoclip 和录制上传中行为一致。`highlightTitle` 是 LLM 生成的高光标题，两者独立
- **代价**: TemplateContext 新增字段，所有构造点需补 `title`。编译期强制（TS），不会遗漏

---

## 2. 模块变更

无新增模块。修改范围：

| 模块                      | 文件                                                             | 变更性质                                                    |
| ------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| types                     | `FfmpegOptions`                                                  | 新增 `accurateSeek?: boolean` 字段                          |
| task/video                | `genMergeAssMp4Command`                                          | 新增 accurateSeek 分支（if/else 隔离）                      |
| autoClip/exportPipeline   | `exportClips`                                                    | 设置 `accurateSeek: true`                                   |
| autoClip/templateRenderer | `TemplateContext` / `renderTitleTemplate` / `renderDescTemplate` | 新增 `title` 字段                                           |
| autoClip/service          | `AutoClipService`                                                | 新增 dailyUploadAids Map + recorderId 链 + title 元数据提取 |

## 3. 接口 / 数据变更

- `FfmpegOptions` 类型扩展：向后兼容（新增可选字段）
- `TemplateContext` 类型扩展：向后兼容（新增必填字段，编译期强制）
- `AutoClipService.autoExportAndUpload` 签名扩展：新增可选 `recorderId?: string`
- `AutoClipService.uploadToBili` 签名扩展：新增可选 `recorderId?: string`

## 4. 风险

| 风险                                 | 概率 | 影响               | 缓解                         |
| ------------------------------------ | ---- | ------------------ | ---------------------------- |
| dailyUploadAids 重启丢失             | 低   | 同天切片再次分散   | v2 从 DB 恢复                |
| accurateSeek 导致时间戳归零影响下游  | 无   | —                  | autoclip 不使用 addTimestamp |
| {{title}} 与 {{highlightTitle}} 混淆 | 低   | 标题模板不符合预期 | AC-7 独立渲染验证            |

## 5. 测试策略

- 3 个新增测试文件覆盖：templateRenderer（+3）、video（+5）、service（+4）
- 全量回归：369 tests all passed
- 路径 B（内置清单）测试质量自检：6 维衰退风险均通过

---

## 9. 技术债记事

- **R6 (🟡 Major)**：dailyUploadAids 重启丢失 → v2 从 DB 恢复
- **R3 (🟡 Major)**：模板变量重复定义 → v2 提取共享 `TemplateVariableProvider`
