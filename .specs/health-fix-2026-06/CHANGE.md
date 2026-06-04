# CHANGE — health-fix-2026-06

> 来源：`.specs/health/2026-06-05-HEALTH.md` 巡检 Critical + Scheduled 项
> 创建：2026-06-05

## 动机

2026-06-05 首次健康巡检评分 **62/100**，发现 2 项 Critical 和 3 项 Scheduled 技术债，本次 change 集中修复。

## 范围

### 🔴 Critical（必修）

| #   | 问题                                                         | 影响                                  | 修复方式                      |
| --- | ------------------------------------------------------------ | ------------------------------------- | ----------------------------- |
| 1   | better-sqlite3 NODE_MODULE_VERSION 不匹配 (143 vs 127)       | 8 个 dbConstraint 测试失败，CI 不可用 | `pnpm rebuild better-sqlite3` |
| 2   | ESLint 配置损坏 (`@vue/eslint-config-typescript` 子路径导出) | ESLint 完全不可用，死代码检测无法运行 | 修复 `.eslintrc.cjs` 引用     |

### 🟡 Scheduled（附带修）

| #   | 问题                                                      | 修复方式                                       |
| --- | --------------------------------------------------------- | ---------------------------------------------- |
| 3   | `@vitest/coverage-v8` 未安装                              | `pnpm add -D @vitest/coverage-v8`（shared 包） |
| 4   | 未使用依赖 `arktype`（shared）                            | 从 `packages/shared/package.json` 移除         |
| 5   | 未使用依赖 `cli-progress` + `@types/cli-progress`（http） | 从 `packages/http/package.json` 移除           |
| 6   | 未使用依赖 `fs-extra`（liveManager）                      | 从 `packages/liveManager/package.json` 移除    |

## 不在范围

- `exportPipeline.ts` 拆分（Scheduled，较大重构，另开 change）
- `files.ts` 路径校验去重（Monitored，下次改到时一并修）
- app 包的 "未使用依赖" 列表（depcheck 在 Electron 下大量误报，需人工逐个确认）

## 验收标准

- [ ] `pnpm rebuild better-sqlite3` 后 8 个 dbConstraint 测试通过
- [ ] ESLint 可正常运行（`npx eslint --version` 无报错，可 lint 任意文件）
- [ ] `@vitest/coverage-v8` 安装成功，`vitest run --coverage` 可产出覆盖率报告
- [ ] 移除的依赖不在 `package.json` 中，`pnpm install` 无警告
- [ ] 全量测试通过（34 文件，506 测试，0 失败）

## 风险

- **低风险**：所有变更为环境/配置/依赖修复，不涉及业务逻辑代码变更
- better-sqlite3 rebuild 可能需 native build tools（`build-essential` + `python3`），CI 环境需确认已有
