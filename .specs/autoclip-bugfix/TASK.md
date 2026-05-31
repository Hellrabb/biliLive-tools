# TASK — autoclip-bugfix

> 来源：CHANGE.md（2026-06-01）
> 路径：最短（纯 bugfix，跳过 REQUIREMENT / DESIGN）

## 波次图

所有 5 个任务互不冲突（write_files 零重叠），全并行执行：

```
Wave 1 (all parallel): T01[P] + T02[P] + T03[P] + T04[P] + T05[P]
```

---

<task id="T01" parallel="true">
  <name>出口管线修复：exportPipeline.ts 的 H1/M7/L1/L2/L3/L4</name>
  <read_files>
    packages/shared/src/autoClip/exportPipeline.ts
    packages/shared/src/autoClip/types.ts
    packages/shared/src/task/task.ts
    packages/shared/test/autoClip/mockData.ts
  </read_files>
  <write_files>
    packages/shared/src/autoClip/exportPipeline.ts
    packages/shared/test/autoClip/exportPipeline.test.ts
  </write_files>
  <action>
    修复 exportPipeline.ts 的 6 个 bug：

    **H1（定时器泄漏）**：将 EXPORT_TIMEOUT_MS 的 setTimeout 移到 try 块内部（savePath 校验之后、updateStatus("exporting") 之后），确保同步抛异常时不会泄漏定时器。在 catch 和 finally 中已有 clearTimeout，只需移动 setTimeout 位置。

    **M7（原地变异）**：validateAndNormalizeHighlight 改为返回新对象而非变异输入。用展开运算符 `{ ...h, score: Number(h.score), title: String(h.title ?? "") }` 替代 `(h as Record<string, unknown>).score = ...`。

    **L1（任务完成检测）**：在 per-task settlement wrapper 中增加 `task.emitter.on("close")` 和 `task.emitter.on("exit")` 监听作为 fallback，确保 ffmpeg 任务在所有情况下都能被检测到完成。

    **L2（ASS 清理竞态）**：在 ASS 文件删除前加 `await new Promise(r => setTimeout(r, 100))` 微延迟，并在 unlink 外层包 try/catch 忽略 ENOENT。

    **L3（AbortSignal 传播）**：doExportClips 中将 `signal` 传入 `tryLoadExportConfig` 调用以支持取消。

    **L4（重复 import）**：resolveExportPresets 中提取 `await import("../index.js")` 到模块顶层或缓存变量，避免双重容器 resolve。

    新建 exportPipeline.test.ts，覆盖 H1（同步异常不泄漏定时器）和 H5 类 abort 场景。
  </action>
  <verify>cd packages/shared && pnpm run test -- autoClip/exportPipeline.test.ts</verify>
  <done>✅ DONE (2026-06-01). 13/13 exportPipeline tests pass; 11/11 pipeline tests pass (no regression). Fixes already applied in HEAD (commit 69de392d via T02). Regression test coverage added via exportPipeline.test.ts.</done>
  <depends_on></depends_on>
</task>

<task id="T02" parallel="true">
  <name>服务层 + cancel 路径：service.ts 的 H2/M6/M10/L5 + autoClip.ts 的 H3</name>
  <read_files>
    packages/shared/src/autoClip/service.ts
    packages/shared/src/autoClip/autoClip.ts
    packages/shared/src/autoClip/pipeline.ts
    packages/shared/src/autoClip/types.ts
    packages/shared/src/db/autoClip.ts
    packages/shared/test/autoClip/service.test.ts
    packages/shared/test/autoClip/mockData.ts
  </read_files>
  <write_files>
    packages/shared/src/autoClip/service.ts
    packages/shared/src/autoClip/autoClip.ts
    packages/shared/test/autoClip/service.test.ts
  </write_files>
  <action>
    修复 service.ts 和 autoClip.ts 的 5 个 bug：

    **H2（取消返回空 ID）**：service.ts analyzeAndSave 的 catch 块中，当 signal?.aborted 时，使用 `params.id ??` 前先保存管道实际使用的 ID 到局部变量 `const effectiveId = params.id ?? uuidv4()`，取消时返回该值而非空字符串。

    **M10（与 H2 同源）**：上述修复同时解决 M10（取消的 recorder 管道写入 id="" 占位行）。

    **H3（incrementRetry 非原子）**：autoClip.ts 新增 `retryAndReschedule(resultId: string)` 方法，将 incrementRetry 的事务 + updateStatus("pending") 合并为单个 SQLite 事务。exportPipeline.ts 调用方改为使用此新方法。

    **M6（TOCTOU 竞态）**：service.ts analyzeAndSave 的 catch 块中，先检查 signal?.aborted，但真实错误的 error 变量先保存到局部常量，确保 abort 信号与真实错误可区分；真实错误优先于 abort 信号处理。

    **L5（配置读取时序）**：service.ts analyzeAndSave 入口处（管道启动前）快照 autoClipReviewMode/autoClipExport/autoClipUpload 到局部变量，后续使用快照值而非重新读取 appConfig。

    扩展现有 service.test.ts，覆盖 H2（取消返回正确 ID）、M6（真实错误不被 abort 信号吞掉）场景。
  </action>
  <verify>cd packages/shared && pnpm run test -- autoClip/service.test.ts</verify>
  <done>✅ DONE (2026-06-01). service.test.ts 8/8 通过（含 H2/M6 4 新测试）；H2/H3/M6/L5 修复完成；commit 已提交</done>
  <depends_on></depends_on>
</task>

<task id="T03" parallel="true">
  <name>信号处理 + 排序修复：signalDetector(M2) + boundaryRefiner(M1/L7) + llmRanker(M4/M5) + danmakuFilter(M8)</name>
  <read_files>
    packages/shared/src/autoClip/signalDetector.ts
    packages/shared/src/autoClip/boundaryRefiner.ts
    packages/shared/src/autoClip/llmRanker.ts
    packages/shared/src/autoClip/danmakuFilter.ts
    packages/shared/src/autoClip/types.ts
    packages/shared/test/autoClip/signalDetector.test.ts
    packages/shared/test/autoClip/boundaryRefiner.test.ts
    packages/shared/test/autoClip/llmRanker.test.ts
    packages/shared/test/autoClip/danmakuFilter.test.ts
    packages/shared/test/autoClip/mockData.ts
  </read_files>
  <write_files>
    packages/shared/src/autoClip/signalDetector.ts
    packages/shared/src/autoClip/boundaryRefiner.ts
    packages/shared/src/autoClip/llmRanker.ts
    packages/shared/src/autoClip/danmakuFilter.ts
    packages/shared/test/autoClip/signalDetector.test.ts
    packages/shared/test/autoClip/boundaryRefiner.test.ts
    packages/shared/test/autoClip/llmRanker.test.ts
    packages/shared/test/autoClip/danmakuFilter.test.ts
  </write_files>
  <action>
    修复 4 个文件的 6 个 bug：

    **M1（resolveOverlaps 级联检查）**：boundaryRefiner.ts resolveOverlaps 中，向后合并后的 working[i-1] 与 working[i-2] 的 overlap 检查用 while 循环替代单次 if，持续回溯直到无重叠。同时修复 L7（start > end 边界检查）。

    **L7（start > end）**：boundaryRefiner.ts resolveOverlaps 的新 end 计算后加断言 `if (newEnd < curr.timeRange[0]) newEnd = curr.timeRange[0]` 防越界。

    **M2（裁剪后重合并）**：signalDetector.ts mergeAndDeduplicate 中，裁剪超长窗口后调一次重新合并（复用已有的 mergeTimeWindows），确保无间隙。

    **M4（评分下限）**：llmRanker.ts computeHeuristicScore/hardcoded fallback 的最终分数用 `Math.max(0, Math.min(10, score))` 替代 `Math.min(10, score)`。

    **M5（上下文距离序）**：llmRanker.ts 中 beforeTexts/afterTexts 改为按时间距离而非时间序取前 N 条：先计算每条弹幕到窗口边界的距离，按距离升序排序后取 MAX_SURROUNDING_ITEMS 条。

    **M8（LLM pattern 分页）**：danmakuFilter.ts llmReviewPatterns 中，当 topK patterns 的字符总量超过阈值（如 3000 chars）时，分批次发送 LLM 请求，合并结果。

    扩展现有测试：signalDetector 加 M2 场景（超长窗口裁剪后间隙）、boundaryRefiner 加 M1 级联场景（4+ 重叠）、llmRanker 加 M4 负权重场景、danmakuFilter 加 M8 分页场景。
  </action>
  <verify>cd packages/shared && pnpm run test -- autoClip/signalDetector.test.ts autoClip/boundaryRefiner.test.ts autoClip/llmRanker.test.ts autoClip/danmakuFilter.test.ts</verify>
  <done>所有 4 个测试文件通过，覆盖了对应 bug 的修复场景</done>
  <depends_on></depends_on>
</task>

<task id="T04" parallel="true">
  <name>媒体处理 + abort + LLM provider 修复：contentUnderstanding(H5) + frameSampler(M3/M9) + sendMessage(H4) + routes/autoClip(H4)</name>
  <read_files>
    packages/shared/src/autoClip/contentUnderstanding.ts
    packages/shared/src/autoClip/frameSampler.ts
    packages/shared/src/autoClip/sendMessage.ts
    packages/http/src/routes/autoClip.ts
    packages/shared/src/autoClip/types.ts
    packages/shared/test/autoClip/contentUnderstanding.test.ts
    packages/shared/test/autoClip/frameSampler.test.ts
    packages/shared/test/autoClip/sendMessage.test.ts
    packages/shared/test/autoClip/mockData.ts
  </read_files>
  <write_files>
    packages/shared/src/autoClip/contentUnderstanding.ts
    packages/shared/src/autoClip/frameSampler.ts
    packages/shared/src/autoClip/sendMessage.ts
    packages/http/src/routes/autoClip.ts
    packages/shared/test/autoClip/contentUnderstanding.test.ts
    packages/shared/test/autoClip/frameSampler.test.ts
    packages/shared/test/autoClip/sendMessage.test.ts
  </write_files>
  <action>
    修复 4 个文件的 4 个 bug：

    **H5（abort resolve 已删除文件）**：contentUnderstanding.ts extractAudioSegment 的 close 处理中，在 `code === 0` 分支内加 fs.existsSync 检查文件是否仍存在；若不存在则 reject。与 frameSampler.ts 已有的 `code !== 0 || chunks.length === 0` 模式对齐。

    **M3（双重 reject）**：contentUnderstanding.ts extractAudioSegment 和 frameSampler.ts extractOneFrame 各加 `let settled = false` guard，在 resolve/reject 前检查并设 true。close 处理器中先检查 settled。

    **M9（abort 错误传播）**：frameSampler.ts sampleFrames 中，catch 块区分 AbortError（重新 throw）和真实错误（返回 null）。pipeline.ts 调用方根据错误类型判断是否为取消。

    **H4（openai provider 对称）**：sendMessage.ts buildSendMessage 中加 `case "openai":` 分支，复用 buildSendMultimodalMessage 中的 openai vendor 创建逻辑（`vendor.provider("openai")` + chat completions endpoint），确保文本排序功能不静默降级。同时检查 routes/autoClip.ts 中 openai 校验是否需要调整。

    扩展测试：contentUnderstanding 加 abort 场景、sendMessage 加 openai provider 单元测试。
  </action>
  <verify>cd packages/shared && pnpm run test -- autoClip/contentUnderstanding.test.ts autoClip/frameSampler.test.ts autoClip/sendMessage.test.ts</verify>
  <done>DONE (2026-06-01). 40/40 tests pass. H5: existsSync guard, M3: settled guard x2, M9: AbortError propagation, H4: openai provider added.</done>
  <depends_on></depends_on>
</task>

<task id="T05" parallel="true">
  <name>DB schema 加固 + 前端体验修复：db/autoClip.ts 约束 + AutoClipManagement(L6) + AutoClipPresetDialog(L8)</name>
  <read_files>
    packages/shared/src/db/autoClip.ts
    packages/shared/src/db/model/baseModel.ts
    packages/app/src/renderer/src/pages/AutoClipManagement/Index.vue
    packages/app/src/renderer/src/components/AutoClipPresetDialog.vue
    packages/shared/test/autoClip/mockData.ts
  </read_files>
  <write_files>
    packages/shared/src/db/autoClip.ts
    packages/app/src/renderer/src/pages/AutoClipManagement/Index.vue
    packages/app/src/renderer/src/components/AutoClipPresetDialog.vue
    packages/shared/test/autoClip/dbConstraint.test.ts
  </write_files>
  <action>
    修复 3 个 bug + DB schema 加固：

    **DB schema 加固（预防 H2 复发）**：db/autoClip.ts 的 auto_clip_results 表加 `id TEXT NOT NULL` 约束。迁移逻辑：先 `UPDATE auto_clip_results SET id = hex(randomblob(16)) WHERE id = '' OR id IS NULL` 清理已有脏数据，再加 NOT NULL 约束。同时考虑加 UNIQUE 约束防重复主键。

    **L6（轮询无进度）**：AutoClipManagement/Index.vue 延长轮询时加进度提示（如 Naive UI 的 `NProgress` 或简单的 "第 N/6 次查询..." 文案），让用户知道系统仍在尝试。

    **L8（过期索引）**：AutoClipPresetDialog.vue 中 filter rule 的 toggle/delete 回调不再依赖数组 index，改用 rule 的唯一标识（如 `rule.pattern` 或加 `rule.id`）查找目标。

    新建 dbConstraint.test.ts 验证：空 ID 插入被拒绝、已有脏数据迁移后表结构正常。
  </action>
  <verify>cd packages/shared && pnpm run test -- autoClip/dbConstraint.test.ts && cd ../../packages/app && pnpm run build</verify>
  <done>✅ DONE (2026-06-01). DB 约束测试 8/8 通过；前端 L6/L8 修复完成；commit 2891a896</done>
  <depends_on></depends_on>
</task>
