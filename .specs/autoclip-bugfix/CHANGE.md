# CHANGE — autoclip-bugfix

> 生成日期：2026-06-01
> 来源：Autoclip 代码审计（2026-05-31 审计报告）

## Why

上一轮全面审计发现 autoclip 模块存在 **22 个 bug**（4 高 / 10 中 / 8 低），覆盖资源泄漏、DB 污染、静默功能降级、竞态条件等多个类别。核心流程虽已稳定（30+ 轮修复），但错误路径清理、取消/abort 边界、跨功能一致性仍有缺陷。

## What

一次性修复全部 22 个审计发现的 bug：

### 高严重度（4个）
| ID | 问题 | 文件 |
|---|---|---|
| H1 | 定时器泄漏：同步代码在 try 前抛异常时 10 分钟定时器永不清理 | `exportPipeline.ts` |
| H2 | 取消管道返回 `id: ""`，recorder 触发时写入空 ID 污染 DB | `service.ts` |
| H4 | `provider: "openai"` 被路由校验接受但 buildSendMessage 不处理，LLM 文本排序静默降级 | `sendMessage.ts`, `routes/autoClip.ts` |
| H5 | abort 触发的 close 回调 resolve 已删除的音频文件 | `contentUnderstanding.ts` |

### 中严重度（10个）
| ID | 问题 | 文件 |
|---|---|---|
| M1 | resolveOverlaps 向后合并后只检查一层，4+ 重叠片段可能残留 | `boundaryRefiner.ts` |
| M2 | 裁剪超长窗口后不重新合并，可能产生覆盖间隙 | `signalDetector.ts` |
| M3 | extractOneFrame/extractAudioSegment abort 时双重 reject → unhandled rejection | `frameSampler.ts`, `contentUnderstanding.ts` |
| M4 | 启发式评分未 clamp 下限，自定义负权重可产生负分 | `llmRanker.ts` |
| M5 | 上下文获取用时间序而非距离序，密集弹幕可能遗漏邻近条目 | `llmRanker.ts` |
| M6 | analyzeAndSave catch TOCTOU：真实错误+延迟 abort 被吞 | `service.ts` |
| M7 | validateAndNormalizeHighlight 原地变异输入对象 | `exportPipeline.ts` |
| M8 | LLM pattern review 单 prompt 可能溢出小窗口模型上下文 | `danmakuFilter.ts` |
| M9 | sampleFrames 两级吞掉 abort 错误 | `frameSampler.ts` |
| M10 | 取消的 recorder 管道写入 id="" 占位行（与 H2 同源） | `service.ts` |
| H3 | incrementRetry+updateStatus 非原子调用有竞态窗口 | `autoClip.ts`, `exportPipeline.ts` |

### 低严重度（8个）
| ID | 问题 | 文件 |
|---|---|---|
| L1 | exportClips 任务完成检测只监听 emitter 事件，不监听 close/exit | `exportPipeline.ts` |
| L2 | ASS 文件清理与任务完成间有竞态窗口（Windows 上更严重） | `exportPipeline.ts` |
| L3 | doExportClips 不传播 AbortSignal 到 tryLoadExportConfig | `exportPipeline.ts` |
| L4 | resolveExportPresets 重复 import DI 容器 | `exportPipeline.ts` |
| L5 | autoClipReviewMode/Export/Upload 在管道完成后读取，可能不一致 | `service.ts` |
| L6 | AutoClipManagement 延长轮询无进度反馈 | `AutoClipManagement/Index.vue` |
| L7 | resolveOverlaps newEnd 计算可能产生 start > end | `boundaryRefiner.ts` |
| L8 | AutoClipPresetDialog 规则操作可能使用过期索引 | `AutoClipPresetDialog.vue` |

## 影响面

- **`packages/shared/src/autoClip/`** — 核心修复，涉及 pipeline、service、exportPipeline、contentUnderstanding、frameSampler、signalDetector、boundaryRefiner、llmRanker、danmakuFilter、sendMessage、autoClip 等模块
- **`packages/http/src/routes/autoClip.ts`** — H4 provider 校验修复
- **`packages/shared/src/db/autoClip.ts`** — H2 预防：加 NOT NULL + UNIQUE 约束防空 ID
- **`packages/app/src/renderer/`** — L6/L8 前端体验修复
- **可含 DB schema 变更**：auto_clip_results 表加约束

## 范围排除

- **不做**：新增功能特性（纯 bugfix）
- **不做**：架构重构或模块拆分
- **不做**：新增 LLM provider（仅修复 openai 对称性）
- **不做**：跨平台兼容性测试（Windows/Mac 上的竞态窗口注明即可）
- **不做**：测试覆盖补齐到非关键路径模块

## 验收线

1. H1-H4 全部修复，且修复后可复现场景不再触发
2. 关键路径（exportPipeline、service、contentUnderstanding）补测试覆盖修复点
3. DB schema 加约束后现有数据迁移无报错
4. `pnpm run test` 全部通过
5. `pnpm run build:base` 构建成功

## 路径建议

纯 bug 修复，无需 REQUIREMENT 或 DESIGN 阶段：

```
最短路径：TASK → DEV → TEST → REVIEW → INTEGRATION
```

理由：
- 需求即审计报告中的 22 个 bug 描述，无需额外 REQUIREMENT
- 修复方案均是局部代码改动（移定时器、加 guard、补 else 分支），无需 DESIGN
- 22 个 bug 拆为 5 个任务组，按文件耦合度分组并行
