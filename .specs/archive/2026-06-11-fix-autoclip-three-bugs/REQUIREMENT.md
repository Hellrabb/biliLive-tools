# REQUIREMENT: fix-autoclip-three-bugs

- **Change ID**: fix-autoclip-three-bugs
- **关联**: `@.specs/fix-autoclip-three-bugs/CHANGE.md`

---

## 用户故事

- **US-1**：作为 autoclip 用户，当同一直播间在同一天产生多段录制时，我希望这些录制产生的切片被聚合到同一个B站投稿（多分P），而不是分散在多个投稿里，以便像录制上传一样保持每日投稿整洁。
- **US-2**：作为 autoclip 用户，我希望切片导出的视频首帧正常显示，而不是出现灰色坏帧，以便观众有良好的观看体验。
- **US-3**：作为 autoclip 用户，我希望在标题模板中使用 `{{title}}` 变量时能正确渲染为直播标题，而不是保留字面值 `{{title}}`，以便与录制系统的模板变量一致。

## 验收准则（AC）

每条用 Given / When / Then，必须可验证。

### AC-1 · 同天切片聚合到同一投稿

- **Given** 同一 recorder 在同一天已导出第一批切片并开始上传（创建了投稿 AID=123）
- **When** 同一 recorder 同一天内第二批切片导出完成
- **Then** 第二批切片应作为新分P追加到 AID=123 的投稿中，而不是创建新的独立投稿
- **验证方式**: `npx vitest run test/autoClip/service.test.ts` — dailyUploadAids 测试用例

### AC-2 · 无 recorderId 时不触发批量

- **Given** 手动触发 autoclip 分析（无 recorderId）
- **When** 切片导出完成并自动上传
- **Then** 每次均创建独立投稿（不触发 daily batching 逻辑）
- **验证方式**: `npx vitest run test/autoClip/service.test.ts` — 空 recorderId 时 dailyUploadAids.get 返回 undefined

### AC-3 · accurateSeek 防止灰帧

- **Given** autoclip 导出配置中使用 re-encode 模式（encoder !== "copy"）
- **When** ffmpeg 命令生成时设置 `accurateSeek: true`
- **Then** 生成的 ffmpeg 命令应使用 `-ss` 作为输入选项且不使用 `-copyts`，`-to` 作为输出选项计算为 `to - ss` 的时长
- **验证方式**: `npx vitest run test/task/video.test.ts` — accurateSeek 测试用例

### AC-4 · accurateSeek 对 stream copy 无效

- **Given** autoclip 导出使用 stream copy 模式（encoder === "copy"）
- **When** 设置 `accurateSeek: true`
- **Then** 仍走原 `-ss` + `-to` 输入选项路径，不添加 `-copyts`
- **验证方式**: `npx vitest run test/task/video.test.ts` — encoder=copy 回退测试

### AC-5 · accurateSeek 不影响现有调用方

- **Given** 现有录制剪辑等调用方未设置 `accurateSeek`（默认 undefined）
- **When** 进行视频切割
- **Then** 行为与之前完全一致：使用 `-ss -copyts -to` 输入选项
- **验证方式**: `npx vitest run test/task/video.test.ts` — legacy 路径测试

### AC-6 · {{title}} 模板变量渲染

- **Given** 视频元数据中包含直播标题 "精彩直播回放"
- **When** 上传标题模板为 `【{{title}}】{{highlightTitle}}` 且 autoclip 高光标题为 "五杀瞬间"
- **Then** 渲染后的上传标题应为 `【精彩直播回放】五杀瞬间`
- **验证方式**: `npx vitest run test/autoClip/templateRenderer.test.ts` — {{title}} 渲染测试

### AC-7 · {{title}} 与 {{highlightTitle}} 独立

- **Given** 视频元数据直播标题 "完整回放" 和 LLM 生成的高光标题 "精彩操作"
- **When** 模板包含 `{{title}}` 和 `{{highlightTitle}}`
- **Then** 两个变量分别渲染为各自的值，互不混淆
- **验证方式**: `npx vitest run test/autoClip/templateRenderer.test.ts` — 独立渲染测试

### AC-8 · 无元数据时空值回退

- **Given** 视频文件无有效元数据（pasrseMetadata 抛异常）
- **When** 模板包含 `{{title}}`
- **Then** `{{title}}` 替换为空字符串，不保留字面值 `{{title}}`
- **验证方式**: `npx vitest run test/autoClip/templateRenderer.test.ts` — 空 title 回退测试

---

## 范围切分

### v1（本次必做）

- B1: dailyUploadAids Map 实现每日批量上传（内存态）
- B2: accurateSeek 选项 + autoclip 导出启用
- B3: TemplateContext 新增 `title` 变量 + 元数据提取
- 补充 12 个新测试用例覆盖上述路径

### v2（下一轮考虑，不本次）

- dailyUploadAids 从 DB 恢复（解决进程重启丢失 AID 的问题，REVIEW R6）
- 提取共享 `TemplateVariableProvider` 统一 autoclip 和录制系统的模板变量（REVIEW R3）
- accurateSeek 与 `addTimestamp` 的兼容方案

### out（永远不做）

- 跨天切片聚合（不同日期的切片合并到同一投稿）
- ffmpeg `copy` 模式下的 accurateSeek 支持（stream copy 无法精确 seek）
- 用户自定义 seek padding 秒数（固定 1 秒不暴露配置）

---

## 非功能性需求

- **性能**: 无。dailyUploadAids Map 操作为 O(1)，无性能影响。
- **可访问性**: 无。
- **安全**: 无新增攻击面。`dailyUploadAids` 仅存 AID（整数），无 PII。
- **兼容性**:
  - accurateSeek 不兼容 `addTimestamp`（已在 JSDoc 声明），autoclip 不使用 `addTimestamp`，无冲突
  - 现有录制剪辑等调用方不设置 `accurateSeek`，行为不受影响
- **可观测性**: 新增 2 条 info 日志（daily batch append + AID 记录），不含 PII/秘钥

## 依赖与假设

- **依赖**: `@renmu/bili-api` 的 `editMedia` API；ffmpeg 无 `-copyts` 时的行为（已广泛验证）
- **假设**: 同一天内同一 recorder 的多次录制会被 recorder 按顺序触发 autoclip；并发导出场景下 dailyUploadAids Map 的单进程访问无竞态
