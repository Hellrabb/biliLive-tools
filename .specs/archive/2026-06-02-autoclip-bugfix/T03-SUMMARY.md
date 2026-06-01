# T03-SUMMARY — 信号处理 + 排序修复

> 日期：2026-06-01
> Change：autoclip-bugfix

## 做了什么

修复 4 个文件共 6 个 bug：

| Bug | 文件               | 修复                                                       |
| --- | ------------------ | ---------------------------------------------------------- |
| M1  | boundaryRefiner.ts | 向后合并后级联回检（已有机制，确认正确）                   |
| L7  | boundaryRefiner.ts | newEnd < start 时保底 1 秒 duration                        |
| M2  | signalDetector.ts  | mergeAndDeduplicate 裁剪窗口后调用 mergeTimeWindows 重合并 |
| M4  | llmRanker.ts       | 启发式评分 `Math.max(0, Math.min(10, ...))` 双端 clamp     |
| M5  | llmRanker.ts       | surrounding context 按时间距离排序，不再按时间序取前 N     |
| M8  | danmakuFilter.ts   | llmReviewPatterns 按 3000 字符阈值分批调用 LLM，合并结果   |

## 改了哪些文件

- `packages/shared/src/autoClip/boundaryRefiner.ts` (+9/-2) — L7 guard
- `packages/shared/src/autoClip/signalDetector.ts` (+2/-1) — M2 re-merge
- `packages/shared/src/autoClip/llmRanker.ts` (+18/-11) — M4 clamp + M5 distance sort
- `packages/shared/src/autoClip/danmakuFilter.ts` (+33/-31) — M8 batch pagination
- `packages/shared/test/autoClip/signalDetector.test.ts` (+56) — M2 test
- `packages/shared/test/autoClip/boundaryRefiner.test.ts` (+123) — M1 cascade test
- `packages/shared/test/autoClip/llmRanker.test.ts` (+88) — M4/M5 tests
- `packages/shared/test/autoClip/danmakuFilter.test.ts` (+91) — M8 tests

## verify 输出

```
Test Files  33 passed | 1 skipped (34)
     Tests  495 passed | 5 skipped (500)
```

全部通过，无回归。

## 6 维自查

- **R1 认知过载**：每个修复 ≤30 行，单函数无嵌套加深
- **R2 变更传播**：仅修改 T03 write_files 声明文件，无越界
- **R3 知识重复**：M8 的 buildPrompt 内联（prompt 模板不同），不复用
- **R4 偶然复杂**：M5 distance sort 用简单数组 + sort，无过度抽象
- **R5 依赖混乱**：未新增 import，沿用既有模块
- **R6 领域扭曲**：变量名 `beforeCandidates`/`afterCandidates`/`dist` 准确描述意图

## 越界检查（R6.5）

- TASK write_files：8 项
- 实际 diff 涉及：8 项
- 越界：0 ✅

## 破坏性变更

无。所有修改为内部实现，公共签名不变。
