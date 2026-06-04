# TASK — health-fix-2026-06

> 环境修复 + 依赖清理 · 单波次（3 个 task）

## Wave 1

```xml
<task id="T01" name="修复 better-sqlite3 + ESLint + 安装覆盖率工具">
  <read_files>
    packages/shared/package.json
    .eslintrc.cjs
  </read_files>
  <write_files>
    .eslintrc.cjs
  </write_files>
  <action>
    1. pnpm rebuild better-sqlite3
    2. 修复 .eslintrc.cjs 中 @vue/eslint-config-typescript 引用
    3. cd packages/shared && pnpm add -D @vitest/coverage-v8
  </action>
  <verify>
    cd packages/shared && npx vitest run  # dbConstraint 全部通过
    npx eslint packages/shared/src/autoClip/pipeline.ts  # 无启动报错
  </verify>
  <done>all 3 subtasks pass</done>
</task>

<task id="T02" name="清理未使用依赖">
  <read_files>
    packages/shared/package.json
    packages/http/package.json
    packages/liveManager/package.json
  </read_files>
  <write_files>
    packages/shared/package.json
    packages/http/package.json
    packages/liveManager/package.json
  </write_files>
  <action>
    1. 从 packages/shared/package.json 移除 arktype
    2. 从 packages/http/package.json 移除 cli-progress + @types/cli-progress
    3. 从 packages/liveManager/package.json 移除 fs-extra
    4. pnpm install 更新 lock 文件
  </action>
  <verify>
    pnpm install --frozen-lockfile  # 无 missing/unused 报错
    pnpm run build:base  # 构建成功
  </verify>
  <done>3 deps removed, build passes</done>
</task>

<task id="T03" name="全量测试 + 覆盖率验证">
  <read_files>
    (none new)
  </read_files>
  <write_files>
    (none)
  </write_files>
  <action>
    1. cd packages/shared && npx vitest run  # 全量通过
    2. cd packages/shared && npx vitest run --coverage  # 覆盖率产出
  </action>
  <verify>
    506 tests pass, 0 fail
    coverage report generated
  </verify>
  <done>all tests green, coverage report exists</done>
</task>
```
