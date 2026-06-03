# REVIEW — autoclip-context-slicing

> 审查日期：2026-06-04

## 审查结论：✅ 通过

### 正确性

| 检查项                                                         | 结果                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `overrideModelId` 正确覆盖 `llm.modelId`                       | ✅ `effectiveModelId = opts.overrideModelId ?? llmCfg.modelId`     |
| 未提供 overrideModelId 时 fallback 到 modelId                  | ✅ nullish coalescing `??`                                         |
| `sendBoundaryRefineMessage` 未提供时 fallback 到 `sendMessage` | ✅ `?? sendMessage!`                                               |
| 仅 `boundaryRefineModelId` 有值时构建专用 sender               | ✅ service.ts 条件判断 + service.test.ts 集成测试                  |
| pipeline 接收 sendBoundaryRefineMessage                        | ✅ service.test.ts: `passes sendBoundaryRefineMessage to pipeline` |
| UI 仅开关 ON 时显示模型输入                                    | ✅ `v-if="boundaryRefineEnabled"`                                  |

### 向后兼容

| 检查项                                    | 结果                |
| ----------------------------------------- | ------------------- |
| `boundaryRefineModelId?: string` optional | ✅ 现有预设不受影响 |
| `overrideModelId?: string` optional       | ✅ 现有调用不变     |
| `sendBoundaryRefineMessage?` optional     | ✅ 现有调用不变     |

### 边界情况

| 场景                                      | 行为                                  | 测试        |
| ----------------------------------------- | ------------------------------------- | ----------- |
| overrideModelId 模型不存在                | 返回 undefined → pipeline fallback    | ✅ 已测     |
| overrideModelId 有效模型                  | 使用该模型                            | ✅ 已测     |
| boundaryRefineModelId 留空                | sendBoundaryRefineMessage = undefined | ✅ 逻辑正确 |
| boundaryRefineModelId 填写但 LLM disabled | buildSendMessage 内部返回 undefined   | ✅ 已有逻辑 |

### 代码风格

| 检查项                                   | 结果                                   |
| ---------------------------------------- | -------------------------------------- |
| 命名与 `asrModelId`/`visionModelId` 一致 | ✅ boundaryRefineModelId               |
| UI 模式与 ASR/视觉模型输入一致           | ✅ n-form-item + n-input + placeholder |
| 类型注释完整                             | ✅ JSDoc on all new fields             |

### 风险

无高风险项。唯一的 `sendMessage!` 非空断言在 `if (sendMessage)` 守卫后，安全。

## Hotfix 审查（2026-06-04，3 commits）

### 正确性

| 检查项                                           | 结果                                                        |
| ------------------------------------------------ | ----------------------------------------------------------- |
| 边界精修 ON 但 ASR+视觉 OFF → log warn + UI 警告 | ✅ pipeline.ts else 分支 + Vue v-if 条件                    |
| timeoutMs 传递到 QwenLLM 构造器                  | ✅ sendMessage.ts → QwenLLM({ timeout: opts.timeoutMs })    |
| 边界精修 180s 超时，主 LLM 保持默认              | ✅ service.ts: timeoutMs: 180_000                           |
| 边界精修逐切片独立 LLM 调用                      | ✅ boundaryRefiner.ts: for 循环 + sendWithTimeout           |
| 单切片失败不回滚其他                             | ✅ try/catch per clip, continue on error                    |
| 日志如实反映精修结果                             | ✅ refinements.length > 0 ? "refined (N clips)" : "skipped" |

### 回归风险

| 检查项                           | 结果        |
| -------------------------------- | ----------- |
| boundaryRefiner.test.ts 11 tests | ✅ 全部通过 |
| pipeline.test.ts 11 tests        | ✅ 全部通过 |
| sendMessage.test.ts 17 tests     | ✅ 全部通过 |
| service.test.ts 12 tests         | ✅ 全部通过 |

### 风险

- 逐切片调用增加 N-1 次 API 请求，可能触发限流。后续可加并发控制（当前串行，保守安全）
- boundaryRefiner 的 `sendWithTimeout` 使用默认 60s 超时——单切片 prompt 远小于批量，60s 足够
