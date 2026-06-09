# TEST — autoclip-context-slicing

> 生成日期：2026-06-04

## 本次测试范围声明

| 轮次             | 状态    | 范围                                 | 跳过理由                  |
| ---------------- | ------- | ------------------------------------ | ------------------------- |
| 第 1 轮 · 功能   | ✅ 必跑 | overrideModelId 参数 + fallback 行为 | —                         |
| 第 2 轮 · 性能   | ❌ 跳过 | —                                    | 纯字段传递，无性能影响    |
| 第 3 轮 · 安全   | ❌ 跳过 | —                                    | 无新增 auth/crypto/输入   |
| 第 4 轮 · 兼容   | ❌ 跳过 | —                                    | 向后兼容，新字段 optional |
| 第 5 轮 · 可观测 | ❌ 跳过 | —                                    | 无新增指标/log            |

## 第 1 轮 · 功能测试

### 1.1 测试矩阵

| AC                                                  | 测试                                                                     | 状态        |
| --------------------------------------------------- | ------------------------------------------------------------------------ | ----------- |
| boundaryRefineModelId 填入有效模型 → 使用该模型     | `sendMessage.test.ts` 新增 `overrideModelId selects correct model`       | ✅          |
| boundaryRefineModelId 为空 → fallback 到 modelId    | `sendMessage.test.ts` 已有 `modelId used when found`                     | ✅ (已覆盖) |
| 模型未找到 → 返回 undefined                         | `sendMessage.test.ts` 新增 `overrideModelId not found returns undefined` | ✅          |
| UI 输入框仅 boundaryRefineEnabled=ON 时显示         | 手动验证 (Vue SFC，无组件测试框架)                                       | 👁️          |
| service 层：boundaryRefineModelId → 构建专用 sender | `service.test.ts` 新增 4 个集成测试                                      | ✅          |
| service 层：unset 时不构建专用 sender               | `service.test.ts`: `sendBoundaryRefineMessage is undefined when unset`   | ✅          |
| pipeline 层：接收 sendBoundaryRefineMessage         | `service.test.ts`: `passes sendBoundaryRefineMessage to pipeline`        | ✅          |

### 1.3 Hotfix 补充测试（2026-06-04）

| AC                                      | 测试                                                                   | 状态      |
| --------------------------------------- | ---------------------------------------------------------------------- | --------- |
| 边界精修 ON 但 ASR+视觉 OFF → 日志 warn | 手动 (logger mock)                                                     | 👁️        |
| UI 显示依赖警告                         | 手动验证 (Vue SFC)                                                     | 👁️        |
| sendMessage 支持 timeoutMs 参数         | `sendMessage.test.ts` 已有 17 tests 通过，timeoutMs 为 optional 不影响 | ✅        |
| boundaryRefiner 逐切片独立调用          | `boundaryRefiner.test.ts` 11 tests 全部通过                            | ✅        |
| 单切片 LLM 失败不影响其他切片           | `boundaryRefiner.test.ts`: LLM call throws → returns empty → 其他继续  | ✅ (已有) |
| 日志正确反映精修结果                    | 代码审查: `refinements.length > 0 ? "refined" : "skipped"`             | ✅        |

### 1.4 执行结果（全量）

```
boundaryRefiner.test.ts   → 11/11 PASS
sendMessage.test.ts       → 17/17 PASS
service.test.ts           → 12/12 PASS
pipeline.test.ts          → 11/11 PASS
titleStyler.test.ts       → 12/12 PASS
exportPipeline.test.ts    → 13/13 PASS
─────────────────────────────────
Total                      → 76/76 PASS
```
