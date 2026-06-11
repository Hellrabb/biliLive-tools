# REQUIREMENT: autoclip B站上传改为同一稿件分P

- **Change ID**: `autoclip-bili-part-upload`
- **关联**: `@.specs/autoclip-bili-part-upload/CHANGE.md`、`@.specs/CONTEXT.md`

---

## 用户故事

- **US-1**：作为直播内容创作者，我想 autoclip 自动上传时将同一天直播的所有高光切片合并到一个B站稿件（以分P形式），以便观众在一个视频页内浏览所有精彩片段，而非被多个独立视频刷屏。

## 验收准则（AC）

### AC-1 · 多切片聚合为单稿件多P

- **Given** 某次 autoClip 分析产生了 N 个高光片段（N ≥ 2），且已全部导出成功
- **When** `uploadToBili` 被调用
- **Then** 只创建 1 个 B站稿件（调用 1 次 `biliApi.addMedia`），该稿件包含 N 个分P
- **验证方式**: 检查日志 `AutoClip: 已添加 1 个B站上传任务到队列`（而非 N 个），且 `addMedia` 的 `filePath` 参数为长度为 N 的数组

### AC-2 · 稿件主标题用 titleTemplate 模板

- **Given** 用户已在 autoclip preset 的 biliUpTemplate 中配置 `titleTemplate`（如 `{{roomName}} {{date}} 直播切片`）
- **When** 上传稿件时
- **Then** 稿件主标题按模板渲染，变量 `{{roomName}}` / `{{date}}` / `{{highlightTitle}}` 正确替换。其中 `highlightTitle` 取第一个切片的标题。
- **验证方式**: 检查 `addMedia` 的 `options.title` 字段为渲染后的标题

### AC-3 · 分P标题默认用切片标题，可配模板

- **Given** 用户**未**配置 `partTitleTemplate`
- **When** 上传时
- **Then** 每个分P标题 = 对应切片的 `highlight.title`
- **Given** 用户配置了 `partTitleTemplate`（如 `{{index}} {{highlightTitle}}`）
- **When** 上传时
- **Then** 每个分P标题按模板渲染，变量替换为对应切片的值
- **验证方式**: 检查 `addMedia` 的 `filePath` 数组中每个元素的 `title` 字段

### AC-4 · 封面用第一个切片自动截帧

- **Given** 用户**未**手动配置 `cover` 模板路径，N 个切片已导出
- **When** 上传时
- **Then** 自动从第一个切片的 bestRange 中点截取封面帧，作为视频主封面（不再为每个切片单独截帧）
- **Given** 用户手动配置了 `cover` 路径
- **When** 上传时
- **Then** 使用手动配置的封面（优先级高于自动截帧）
- **验证方式**: 检查 `addMedia` 的 `options.cover` 为第一个切片的自动截帧路径（或手动 cover 路径）

### AC-5 · 单切片行为不变（降级为单P稿件）

- **Given** 某次 autoClip 只产生了 1 个高光片段
- **When** `uploadToBili` 被调用
- **Then** 正常创建 1 个稿件（1P），不报错不跳过
- **验证方式**: 单切片场景下，`addMedia` 的 `filePath` 为长度为 1 的数组，上传正常完成

---

## 范围切分

### v1（本次必做）

- `uploadToBili` 方法重构：一次性收集所有切片传 `addMedia`，不再逐切片循环
- 稿件主标题用 `titleTemplate` 渲染
- 分P标题默认 `highlight.title`，支持 `partTitleTemplate` 回退
- 封面改为只截取第一个切片的帧
- 单切片场景（N=1）正常处理

### v2（下一轮考虑，不本次）

- `partTitleTemplate` 中 `{{index}}` 变量的自动序号（当前需用户模板中配置）
- 多切片封面可选策略（如「每个P独立封面」vs「统一封面」）

### out（永远不做）

- 前端 UI 变更（上传行为变更对前端透明）
- 手动导出/重导出路径（HTTP route）的修改（走独立路径）
- 切片数量上限或「合并/分开」的用户开关（统一为分P行为，不做可配置）

---

## 非功能性需求

- **性能**: 无（`addMedia` 从 N 次调用改为 1 次调用，性能提升）
- **可访问性**: 无
- **安全**: 无（不涉及权限/认证变更）
- **兼容性**: 与现有 `biliApi.addMedia` 多 video 参数兼容（录制上传已验证）
- **可观测性**: 保留现有日志结构，调整日志文案（`已添加 N 个B站上传任务` → `已添加 1 个B站上传任务（含 N 个分P）`）

## 依赖与假设

- 依赖 `packages/shared/src/task/bili.ts` 的 `addMedia` 方法（已支持多 video 数组作为分P）
- 依赖 `packages/shared/src/autoClip/service.ts` 的现有 `exportClips` / `sampleFrames` 等
- 假设 B站 API 的多P稿件创建接口与录制上传路径一致（已验证）
- 假设同一次 autoClip 的所有切片来自同一直播录制文件（符合当前 pipeline 设计）

---

> AC 是 TEST 阶段派生用例的唯一来源，禁止在 TEST 阶段引入新 AC。
