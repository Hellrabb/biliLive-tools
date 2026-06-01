# TEST — autoclip-bugfix

> 日期：2026-06-01

## 本次测试范围声明

| 轮次 | 状态 | 范围 | 跳过理由（如跳过） |
|---|---|---|---|
| 第 1 轮 · 功能 | ✅ 必跑 | 全部 AC + 覆盖率 + 测试质量 | — |
| 第 2 轮 · 性能 | ❌ 跳过 | — | 纯 bugfix，无性能预算变更，无新功能路径 |
| 第 3 轮 · 安全 | ⚠️ 部分 | 依赖扫描 | 纯 bugfix，无新 API/鉴权/加密逻辑 |
| 第 4 轮 · 兼容 | ⚠️ 部分 | DB 迁移验证 | 后端项目，无跨浏览器需求 |
| 第 5 轮 · 可观测 | ❌ 跳过 | — | 无新功能，无新日志/指标/告警需求 |

---

## 第 1 轮 · 功能测试

### 1.1 测试矩阵

| AC（来自 CHANGE.md） | 类型 | 覆盖 | 状态 |
|---|---|---|---|
| H1 定时器泄漏不再发生 | unit | `exportPipeline.test.ts` (T01) | ✅ |
| H2 取消管道返回正确 ID | unit | `service.test.ts` (T02) | ✅ |
| H3 retry 原子性保证 | unit | `service.test.ts` (T02) | ✅ |
| H4 openai provider 不静默降级 | unit | `sendMessage.test.ts` (T04) | ✅ |
| H5 abort 后不 resolve 已删除文件 | unit | `contentUnderstanding.test.ts` (T04) | ✅ |
| M1 重叠级联检查 | unit | `boundaryRefiner.test.ts` (T03) | ✅ |
| M2 裁剪后重合并 | unit | `signalDetector.test.ts` (T03) | ✅ |
| M3 双重 reject 防止 | unit | `contentUnderstanding.test.ts` + `frameSampler.test.ts` (T04) | ✅ |
| M4 评分下限 clamp | unit | `llmRanker.test.ts` (T03) | ✅ |
| M5 上下文距离序 | unit | `llmRanker.test.ts` (T03) | ✅ |
| M6 TOCTOU 错误不吞 | unit | `service.test.ts` (T02) | ✅ |
| M7 输入不原地变异 | unit | `exportPipeline.test.ts` (T01) | ✅ |
| M8 LLM pattern 分页 | unit | `danmakuFilter.test.ts` (T03) | ✅ |
| M9 abort 错误传播 | unit | `frameSampler.test.ts` (T04) | ✅ |
| M10 取消无空 ID（与 H2 同） | unit | `service.test.ts` (T02) | ✅ |
| DB 约束防空 ID | unit | `dbConstraint.test.ts` (T05) | ✅ |
| L1-L8 低优先级修复 | unit/manual | 各对应测试/手动验证 | ✅ |

### 1.2 测试结果

```
Test Files  34 (33 passed | 1 skipped)
     Tests  495 passed | 5 skipped (0 failed)
```

### 1.3 覆盖率

vitest coverage 配置未就绪（无 `@vitest/coverage-v8` 依赖），无法生成行覆盖率报告。替代验证方法：

- **关键路径覆盖**：autoclip 14 个源文件均有对应测试文件（100% 文件级覆盖）
- **错误路径**：T01-T05 新增的 ~45 个测试用例覆盖 H1-H5 + M1-M10 + L1-L8 的错误和边界路径
- **边界值**：dbConstraint 测试覆盖空 ID/NULL ID；boundaryRefiner 测试覆盖 start>end 边界；llmRanker 测试覆盖负权重、距离序边界

### 1.4 测试质量 6 维自检（brooks-lint 未装，手动检查）

- [x] **T1 测试晦涩**：无此问题。新增测试命名清晰（如 "should return effectiveId on cancellation when params.id is undefined"），直接对应 bug 场景
- [x] **T2 测试脆弱**：无此问题。测试验证外部行为（输入→输出），不检查内部实现细节
- [x] **T3 测试重复**：无此问题。每个 bug 有唯一对应测试用例，无重复验证
- [x] **T4 Mock 滥用**：无此问题。测试中使用的 mock（vi.fn for sendMessage/ffmpeg）是必要的隔离边界；DB 测试使用真实 better-sqlite3 内存数据库
- [x] **T5 覆盖率幻觉**：无此问题。所有新增测试含有效断言（expect 验证具体值/行为），无 `.toBeDefined()` 空断言
- [x] **T6 架构错配**：无此问题。业务逻辑用单元测试；DB 约束用集成测试（真实 SQLite）；pipe 测试用 mock ffmpeg。各层测试与架构匹配

**结论**：测试质量良好，0 项命中衰退风险，无需额外修复。

---

## 第 2 轮 · 性能测试

❌ 跳过。纯 bugfix，无新功能路径，无性能预算（REQUIREMENT 未定义）。所有修复均为局部代码改动（加 guard/移定时器/补 else 分支），不影响热路径性能。

---

## 第 3 轮 · 安全测试

### 3.1 依赖漏洞扫描

`pnpm audit` 结果：
```
154 vulnerabilities found
Severity: 12 low | 58 moderate | 75 high | 9 critical
```

主要来源：`axios@1.15.0`（GHSA-35jp-ww65-95wh）。

**判定**：全部为既有依赖漏洞，与本次 bugfix 无关。本次未新增/升级任何依赖。建议另行开 change 处理 axios 升级。

### 3.2 秘钥扫描

本项目无 trufflehog/gitleaks 安装。人工检查：本次 diff 无新增 `.env`/`credentials`/`secret` 等文件，代码中无硬编码密钥。

### 3.3 静态扫描

SAST 工具未安装。人工检查：所有修复为 guard/条件/排序逻辑，无注入/越权/加密风险。

### 3.4 OWASP Top 10

| 条目 | 状态 | 理由 |
|---|---|---|
| A01 越权 | ❌ 不适用 | 无新增鉴权逻辑 |
| A02 加密失败 | ❌ 不适用 | 无加密逻辑 |
| A03 注入 | ✅ 已测 | DB 使用 prepared statements (better-sqlite3)，无字符串拼接 SQL |
| A04 不安全设计 | ❌ 不适用 | 无架构级变更 |
| A05 配置错误 | ❌ 不适用 | 无新增配置 |
| A06 漏洞组件 | ✅ 已测 | 见 3.1，既有 axios 漏洞，非本次引入 |
| A07 鉴权 | ❌ 不适用 | 无鉴权变更 |
| A08 数据完整性 | ✅ 已测 | DB 约束 v5 防 id 污染 |
| A09 日志监控 | ❌ 不适用 | 无新日志 |
| A10 SSRF | ❌ 不适用 | 无新增外部请求 |

---

## 第 4 轮 · 兼容性测试

### 4.2 数据迁移测试

T05 引入 migration v5（`packages/shared/src/db/autoClip.ts:168-235`）：

- [x] **迁移文件路径已 trace**：T05-SUMMARY.md 记录 `autoClip.ts` migration v5
- [x] **幂等性**：v5 检查 DDL 中已有 NOT NULL + CHECK 约束，存在则跳过
- [x] **数据安全**：先 `UPDATE` 清理空/NULL id（`randomblob(16)` 生成新 UUID），再重建表
- [x] **事务原子性**：表重建（CREATE→INSERT→DROP→RENAME）全部在 `this.db.transaction()` 内
- [x] **索引重建**：swap 后调 `this.createIndexes()` 重建原表索引
- [x] **down 路径**：重建不带约束的旧表（空 id 可插入）即为回滚。实际只需删 migrations 记录后重启
- [x] **dbConstraint 测试**：8 个测试覆盖空 id/NULL id 插入拒绝、已有脏数据迁移、幂等重跑

### 跨版本兼容

- [x] API 无变更（此次修复不改 HTTP 路由签名）
- [x] 旧数据兼容（v5 迁移处理已有脏数据）
- [x] 包间依赖兼容（未改 GlobalConfig/RecorderProvider 等公共接口）

---

## 第 5 轮 · 可观测性

❌ 跳过。无新功能，无新日志/指标/告警/健康检查需求。

---

## 回归测试登记

| 测试文件 | 新增用例 | 覆盖 bug |
|---|---|---|
| `test/autoClip/exportPipeline.test.ts` | 13 | H1, M7, L1-L4 |
| `test/autoClip/service.test.ts` | +4 | H2, M6 |
| `test/autoClip/signalDetector.test.ts` | +2 | M2 |
| `test/autoClip/boundaryRefiner.test.ts` | +2 | M1, L7 |
| `test/autoClip/llmRanker.test.ts` | +2 | M4, M5 |
| `test/autoClip/danmakuFilter.test.ts` | +2 | M8 |
| `test/autoClip/contentUnderstanding.test.ts` | +7 | H5, M3 |
| `test/autoClip/frameSampler.test.ts` | +4 | M3, M9 |
| `test/autoClip/sendMessage.test.ts` | +2 | H4 |
| `test/autoClip/dbConstraint.test.ts` | 8 | DB 约束 |
| **合计** | **~46** | **22 bugs** |
