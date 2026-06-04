# LESSONS.md — biliLive-tools

> 记录开发中反复出现的问题模式，供后续 change 参考。

## 活跃条目

### 观察（Monitored）

- **2026-06-05** | `files.ts` 路径校验逻辑去重 — `packages/http/src/routes/files.ts:171-217` 存在 10 行 × 2 处内部重复块，建议提取 `validateFilePath()`。触发条件：下次修改 files.ts 时一并重构。
- **2026-06-05** | `signalDetector.ts` (591行) 复杂度持续监控 — 当前为 autoClip 最大单文件，若继续增长至 700+ 行则强制拆分。触发条件：每次修改 signalDetector.ts 时检查行数。
- **2026-06-05** | `NotificationType` / `LLMType` 导出确认 — ts-prune 报告零引用，需确认是否为公共 API 后更新 CONTEXT.md「既有抽象索引」或移除导出。触发条件：下次涉及 enum.ts 的修改时一并确认。

## 已关闭条目

- **2026-06-05** | `health-fix-2026-06` — better-sqlite3 原生模块不兼容（预编译二进制 Node 24 但运行时 Node 22），通过 `node-gyp rebuild` 从源码重编译解决。教训：`pnpm rebuild` 不一定能解决原生模块问题——如果预编译二进制存在，pnpm 可能跳过了源码编译。需 `rm -rf build/ && npx node-gyp rebuild` 强制源码重编译。
- **2026-06-05** | `health-fix-2026-06` — ESLint plugin 栈版本不兼容（ESLint 8 vs flat config）。教训：`@vue/eslint-config-typescript@14+` 和 `@vue/eslint-config-prettier@10+` 都要求 ESLint 9+。ESLint 8 项目必须锁版 `@vue/eslint-config-typescript@13` + `@vue/eslint-config-prettier@8`。长期应迁移到 flat config。
- **2026-06-05** | `health-fix-2026-06` — vitest 覆盖率工具版本匹配：`@vitest/coverage-v8@4.x` 需要 `vitest@4.x`，使用 `vitest@3.x` 的项目需安装 `@vitest/coverage-v8@3.x`。
