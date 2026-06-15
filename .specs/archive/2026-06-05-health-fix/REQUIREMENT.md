# REQUIREMENT — health-fix-2026-06

> 来源：`.specs/health/2026-06-05-HEALTH.md`
> 类型：环境修复 + 依赖清理（无业务逻辑变更）

## v1（本次必做）

### R1: 修复 better-sqlite3 原生模块

**Given** CI 或本地 Node.js 版本与编译时的 NODE_MODULE_VERSION 不匹配
**When** 运行 `pnpm rebuild better-sqlite3`
**Then** 原生模块重新编译匹配当前 Node 版本，`dbConstraint.test.ts` 8 个测试全部通过

### R2: 修复 ESLint 配置

**Given** `.eslintrc.cjs` 引用了 `@vue/eslint-config-typescript/recommended` 但该子路径在新版包中不存在
**When** 更新引用为兼容路径
**Then** `npx eslint --version` 无报错，可正常 lint 文件

### R3: 安装覆盖率工具

**Given** `@vitest/coverage-v8` 未安装
**When** `pnpm add -D @vitest/coverage-v8`（在 shared 包）
**Then** `vitest run --coverage` 可产出覆盖率报告

### R4: 清理未使用依赖

**Given** depcheck 报告 `arktype`（shared）、`cli-progress`（http）、`fs-extra`（liveManager）未使用
**When** 从对应 `package.json` 移除这些依赖
**Then** `pnpm install` 无警告，构建不受影响

## v2（后续）

- app 包的 "未使用依赖" 列表人工逐个确认（Electron 误报率高）
- `exportPipeline.ts` 拆分（较大重构，另开 change）

## out（明确不做）

- 业务逻辑代码变更
- `files.ts` 去重（下次自然触及再修）
