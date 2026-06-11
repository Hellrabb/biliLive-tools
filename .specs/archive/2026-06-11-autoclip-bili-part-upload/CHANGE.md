# CHANGE: autoclip B站上传改为同一稿件分P

- **Change ID**: `autoclip-bili-part-upload`
- **创建日期**: 2026-06-11
- **路径建议**: 完整
- **状态**: draft

---

## Why（为什么做）

当前 autoclip 自动上传 B站时，每天直播的每个切片都创建一个独立稿件。用户期望和录制上传行为一致：同一天直播的所有切片放进**一个稿件**，每个切片作为**一个分P**。这样观众在一个视频里就能看完当天所有高光，不会刷屏多个独立视频。

## What（做什么）

修改 `packages/shared/src/autoClip/service.ts` 的 `uploadToBili` 方法：将原来的「循环逐切片调用 `addMedia` 创建独立稿件」改为「将所有切片收集后，单次调用 `addMedia` 传入多个 video，创建一个多P稿件」。

同时对齐录制上传的封面逻辑和分P标题逻辑。

## 影响面

- [x] 影响 `REQUIREMENT.md`
- [x] 影响 `DESIGN.md`
- [ ] 影响现有 AC
- [ ] 影响数据模型 / 迁移
- [ ] 影响外部 API 兼容性
- [ ] 仅修复 bug，无范围变化

## 范围排除（这次不做）

- 不改变切片导出/裁剪管线（exportClips）
- 不改变通知逻辑
- 不改变前端 UI
- 不改变手动导出/重导出路径（HTTP routes）
- 不做「单切片时不创建分P稿件」的特殊处理——统一行为，单切片也是单P稿件

## 验收线（粗粒度，不是 AC）

- 同一次 autoClip 分析出的 N 个切片 → 自动上传后生成 1 个 B站稿件 + N 个分P
- 稿件主标题使用 `titleTemplate` 模板渲染
- 分P标题默认用 `highlight.title`，若配置了 `partTitleTemplate` 则用模板
- 封面使用第一个切片的自动截帧（与录制上传封面逻辑一致）
- 单切片场景（N=1）：行为不变，仍正常上传（只是从独立稿件变为1P稿件）

## 风险与未知

- `addMedia` 传入多个 video 的批量上传在 B站 API 端的稳定性（已有录制上传验证，risk low）
- 封面截帧时机：当前每切片独立截帧，改为取第一个切片截帧后，其余切片的截帧可跳过（性能优化点）

---

> 后续 AC 与设计细节进入 `REQUIREMENT.md` / `DESIGN.md`，本文件不再扩展。
