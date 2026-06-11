# TASK: fix-autoclip-three-bugs

- **Change ID**: fix-autoclip-three-bugs
- **关联**: `REQUIREMENT.md` / `DESIGN.md`

---

## 任务分解

### T01 · accurateSeek 类型定义

- **文件**: `packages/types/src/index.ts`
- **动作**: `FfmpegOptions` 新增 `accurateSeek?: boolean`
- **验证**: `npx tsc --noEmit` 零错误
- **状态**: ✅ done

### T02 · accurateSeek ffmpeg 命令生成

- **文件**: `packages/shared/src/task/video.ts` — `genMergeAssMp4Command`
- **动作**: 新增 if/else 分支，accurateSeek 模式下移除 `-copyts`，`-to` 改为 output option
- **验证**: `npx vitest run test/task/video.test.ts` — 5 个 accurateSeek 测试用例
- **状态**: ✅ done

### T03 · autoclip 导出启用 accurateSeek

- **文件**: `packages/shared/src/autoClip/exportPipeline.ts`
- **动作**: 在 autoclip 导出的 ffmpeg options 中设置 `accurateSeek: true`
- **验证**: 类型检查 + 集成测试，`exportClips` mock 验证字段透传
- **状态**: ✅ done

### T04 · {{title}} 模板变量支持

- **文件**: `packages/shared/src/autoClip/templateRenderer.ts`
- **动作**: `TemplateContext` 新增 `title`；`renderTitleTemplate`/`renderDescTemplate` 传递该变量
- **验证**: `npx vitest run test/autoClip/templateRenderer.test.ts` — 3 个新测试
- **状态**: ✅ done

### T05 · title 元数据提取

- **文件**: `packages/shared/src/autoClip/service.ts` — `uploadToBili`
- **动作**: 从 `pasrseMetadata().title` 提取直播标题赋值给 `ctx.title`
- **验证**: 类型检查 + service 测试覆盖
- **状态**: ✅ done

### T06 · 每日批量上传基础设施

- **文件**: `packages/shared/src/autoClip/service.ts`
- **动作**:
  - 新增 `dailyUploadAids` Map
  - 传递 `recorderId` 链: `analyzeAndSave` → `autoExportAndUpload` → `uploadToBili`
  - 首次上传 `addMedia` + 监听 `task-end` 记录 AID
  - 同天后续上传 `editMedia` 追加
- **验证**: `npx vitest run test/autoClip/service.test.ts` — 4 个 dailyUploadAids 测试
- **状态**: ✅ done

### T07 · 全量回归 + 补充测试

- **动作**: 跑全量 autoclip + task 测试，补充 12 个新测试用例
- **验证**: 23 files, 369 tests all passed
- **状态**: ✅ done

---

## 阻塞关系

```
T01 → T02 → T03
T04 → T05
T06（独立）
T07（依赖 T01-T06）
```

无阻塞项，全部已完成。
