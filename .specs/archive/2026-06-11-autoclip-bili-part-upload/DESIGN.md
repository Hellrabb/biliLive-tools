# DESIGN: autoclip B站上传改为同一稿件分P

- **Change ID**: `autoclip-bili-part-upload`
- **关联**: `@.specs/autoclip-bili-part-upload/REQUIREMENT.md`、`@.specs/CONTEXT.md`
- **作者**: AI（Architect 角色）+ 人工 review

---

## 0. 技术栈选定

> 锁定为既有栈，本 change 不引入新技术栈。

- **选定**：既有栈（Node.js 22 + TypeScript + awilix DI）
- **前端**：N/A（纯后端逻辑变更）
- **后端**：TypeScript ESM，awilix DI 容器，better-sqlite3
- **数据库**：N/A（不涉及 schema 变更）
- **部署**：Electron / CLI（与既有一致）
- **关键依赖**：`packages/shared/src/task/bili.ts`（addMedia）、`packages/shared/src/autoClip/exportPipeline.ts`（exportClips / sampleFrames）
- **理由**：纯行为变更，不换栈不引新包
- **明确排除**：无新选型

---

## 0.5 既有架构对齐（brownfield · B2 护栏）

### 0.5.1 本次 change 触碰的既有模块

```
触碰模块（grep 出来的实际清单）：
- packages/shared/src/autoClip/service.ts（uploadToBili · 既有 · 修改）
- packages/shared/src/autoClip/service.ts（autoExportAndUpload · 既有 · 只读）
- packages/shared/src/task/bili.ts（addMedia · 既有 · 调用方式变更）
- packages/shared/src/autoClip/exportPipeline.ts（exportClips / sampleFrames · 既有 · 调用方式变更）

新增模块：
- 无

禁动清单（与本次无关，AI 不许"顺手"碰）：
- packages/shared/src/autoClip/pipeline.ts（核心分析管线）
- packages/shared/src/task/video.ts（ffmpeg cut 管线）
- packages/http/src/routes/autoClip.ts（手动导出路由）
- packages/app/src/renderer/src/（前端 UI）
```

### 0.5.2 既有抽象沿用对照表

| 本次需要            | 既有有没有？路径                                                                              | 决定                                   |
| ------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------- |
| B站稿件创建（分P）  | `packages/shared/src/task/bili.ts` `addMedia(filePath[], options, uid)` 已支持多 video 数组   | 沿用                                   |
| 封面自动截帧        | `packages/shared/src/autoClip/exportPipeline.ts` `sampleFrames()` 已有                        | 沿用，改调用方式（只截 1 帧而非 N 帧） |
| 标题模板渲染        | `service.ts` 内已有 `renderTitleTemplate` / `renderDescTemplate`                              | 沿用                                   |
| 录制上传分P模式参考 | `packages/http/src/services/webhook/webhook.ts:1044` `addMedia(pathArray, options, uid, ...)` | 对齐模式                               |

### 0.5.3 沿用模式 vs 引入新模式

- **上传模式**：**沿用**录制上传的 addMedia 批量数组调用模式（webhook.ts L1044 `biliApi.addMedia(pathArray, options, uid)`）。autoclip 之前逐切片调 addMedia 是偏离了录制上传的分P范式
- **封面提取**：**沿用** sampleFrames 截帧，改从"每个切片截一帧"为"只截第一个切片"
- **错误处理**：**沿用** try/catch + logger.error（既有 autoclip service 风格）
- **没有引入新模式**，纯聚合已有抽象

---

## 1. 决策清单

| #   | 决策                                                           | 备选                                    | 选择理由                                                                                                | 取舍代价                                                                |
| --- | -------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| D1  | 聚合所有切片为一次 `addMedia` 调用                             | 保持逐切片独立调用                      | 与录制上传分P行为一致；B站 `addMedia` 的 `filePath: Array<{path, title}>` 已原生支持分P                 | 批量失败时所有切片一起失败（vs 逐切片可部分成功），但录制上传已验证可靠 |
| D2  | 封面只截第一个切片的帧                                         | 继续逐切片截帧各用各的                  | 视频主封面只需一张；减少 FFmpeg 调用次数（N→1）                                                         | 若第一个切片截帧失败则回退到手动 cover 或无封面                         |
| D3  | 分P标题默认用 `highlight.title`，支持 `partTitleTemplate` 覆盖 | 强制用 partTitleTemplate 模板           | 与录制上传一致（webhook.ts L1118: `partTitleTemplate ?? "{{filename}}"`，有模板就用，没有就回退默认值） | 需要额外一次 renderTemplate 调用                                        |
| D4  | 稿件主标题的 `{{highlightTitle}}` 变量取第一个切片的标题       | 用房间名/日期等通用模板（不含切片标题） | 用户已配置了含 highlightTitle 变量的模板，保持兼容                                                      | 若第一个切片标题不具代表性，视频标题可能不够准确                        |

---

## 2. 数据流 / 架构图

```
                         autoClip pipeline 完成
                                │
                                v
                        autoExportAndUpload()
                                │
                                v
                        exportClips(video, highlights)
                          ┌─────┴─────┐
                          v           v
                     success[]    failed[]
                          │
                          v
                uploadToBili(success[], appConfig, presetConfig, videoPath)
                          │
                          ├── 1. 取第一个切片的 bestRange 中点
                          │      └── sampleFrames(videoPath, [midSec]) → cover.jpg
                          │
                          ├── 2. 用第一个切片的 highlight.title 渲染 titleTemplate
                          │      └── title = renderTemplate(titleTemplate, {highlightTitle: highlights[0].title, ...})
                          │
                          ├── 3. 构建分P数组
                          │      for each highlight:
                          │        partTitle = partTitleTemplate
                          │          ? renderTemplate(partTitleTemplate, {highlightTitle, index})
                          │          : highlight.title
                          │        → { path: exportedClip.path, title: partTitle }
                          │
                          └── 4. 单次调用 biliApi.addMedia
                                 addMedia(
                                   [{path: clip1, title: "P1标题"}, {path: clip2, title: "P2标题"}, ...],
                                   { title, desc, tag, tid, cover, ... },
                                   uid
                                 )
                                     │
                                     v
                              1 个 B站稿件 含 N 个分P

        变更前后对比：
        ─────────────────────────────────────────────
        变更前:  clip1 → addMedia([{p1}]) → 稿件A
                clip2 → addMedia([{p2}]) → 稿件B
                clip3 → addMedia([{p3}]) → 稿件C
        ─────────────────────────────────────────────
        变更后:  clip1 ─┐
                clip2 ─┼─→ addMedia([{p1},{p2},{p3}]) → 1个稿件 N个分P
                clip3 ─┘
        ─────────────────────────────────────────────
```

---

## 3. 关键状态机（如有）

本 change 无新增状态机。`uploadToBili` 原本就是 fire-and-forget 异步方法，不维护上传状态。变更后保持这一模式。

---

## 4. ADR 索引

本 change 无不可逆决策。所有决策（D1-D4）均可在 `uploadToBili` 方法内回滚，无需独立 ADR。

---

## 5. 风险

| #              | 风险                                                                                     | 影响                        | 概率 | 缓解                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------- | --------------------------- | ---- | ------------------------------------------------------------------------------------------------------ |
| R1（实现）     | `addMedia` 批量上传时，B站 API 返回部分失败（如某分P文件损坏）                           | 整体稿件创建失败，无分P可看 | 低   | `addMedia` 内部有 preFormatOptions 文件存在性检查；录制上传已验证批量路径                              |
| R2（实现）     | 第一个切片的自动封面截帧失败                                                             | 视频无封面                  | 低   | 已有回退链：手动 cover 路径 → DEFAULT_BILIUP_CONFIG.cover（空字符串）                                  |
| R3（上线）     | 用户模板 `{{highlightTitle}}` 期望的是「每个切片自己的标题」，改为取第一切片后不符合预期 | 视频标题与内容不匹配        | 低   | 用户可改为不含 highlightTitle 的模板（如 `{{roomName}} {{date}} 直播切片`），已有 titleTemplate 可配制 |
| R4（长期债务） | 未来如需支持「可选择独立稿件或分P」                                                      | 单次重构不够，需加配置开关  | 低   | 当前需求已明确：统一分P行为。如需回退，改回逐切片循环即可                                              |

---

## 6. 不在范围

- 不添加「独立稿件 vs 分P」的用户可配置开关（当前设计统一为分P）
- 不修改手动导出/重导出路径（`routes/autoClip.ts`）
- 不修改前端 UI 任何组件
- 不做切片数量上限保护（录制文件大小自然限制切片数）

---

## 9. 架构沉淀建议

本 change 无架构层面沉淀建议。不引入新抽象、新决策、新依赖或新契约。纯行为变更——将已有 `addMedia` 的调用方式从循环改为批量聚合。
