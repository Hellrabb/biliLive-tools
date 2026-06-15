# REVIEW — fix-docker-security-regressions

> 审查日期：2026-06-16
> 模式：PR Review（brooks-lint 6 维诊断）
> Scope：6 source files + 3 test files, +85/-30 lines, small change

---

## 第一轮 · Spec 合规审查

对照 `CHANGE.md` 声明的 4 个回归问题 + 测试改善：

| #   | AC（来自 CHANGE.md）              | 实现                                                            | 覆盖                                |
| --- | --------------------------------- | --------------------------------------------------------------- | ----------------------------------- |
| 1   | 修复 `build:webui` typecheck 失败 | `user.ts:3` import 修正 ✅                                      | build:webui 通过 ✅                 |
| 2   | verifyBiliKey 回退到 config 文件  | `config.ts:53` try/catch + appConfig.get ✅                     | `config_verify.test.ts` 已有覆盖 ✅ |
| 3   | 旧密钥回退                        | `bili.ts:1075` LEGACY_DEFAULT_PASSKEY + `getKeyCandidates()` ✅ | `bili.test.ts` 已有覆盖 ✅          |
| 4   | 密钥来源日志                      | `config.ts:120-135` env 来源/随机生成日志 ✅                    | 无单元测试（日志输出）🟡            |
| 5   | 消滅 skipped tests                | alist mock + stream-get mock + jsdom + e2e exclude ✅           | 951 passed, 0 skipped ✅            |

**范围蔓延检查**：无新增功能超出 CHANGE.md 范围。

**结论**：🔴 无，🟡 1 项（AC#4 日志无单元测试，但日志是副作用，验收标准是"能在 Docker logs 看到"，属集成验证范畴）。

---

## 第二轮 · 代码质量审查（6 维衰退风险）

### Step 1: Understand the scope

- **目的**：修复 `e4db89f5` 安全提交的 4 个回归 + 改善测试基线
- **改动文件**：6 源文件 + 3 测试文件 + 1 配置
- **跨模块评估**：变更涉及 renderer、http routes、shared config、shared task、docker compose — 但每个改动都是为同一目的（密钥管理修复），非无关修改。

### Step 2: Change Propagation (R2)

```
🟢 R2 · Change Propagation：无显著传播风险
**Symptom**：6 个源文件跨 4 个包（app/renderer, http, shared/config, shared/task），
但均为同一密钥管理链上的关联变更 — user.ts import 修复 → config.ts verifyBiliKey → bili.ts 回退 → config.ts 日志。
**Source**：Fowler · Refactoring · Shotgun Surgery（本次改动每个文件修改理由唯一，非 shotgun）
**Consequence**：无。未来修改密钥体系的开发者只需关注 shared/config + shared/task/bili 两个文件。
**Remedy**：无需改动。
```

### Step 3: Cognitive Overload (R1)

```
🟢 R1 · Cognitive Overload：无认知过载
**Symptom**：检查所有新增/修改函数：
- config.ts init(): 新增 22 行（逻辑平铺：读 env → 生成 → 查已有 → 写 → 日志），无超 20 行新增函数
- config.ts verifyBiliKey route: 新增 IIFE try/catch（6 行），IIFE 略显突兀但意图清晰
- bili.ts getKeyCandidates(): 新增 1 行 keys.push()
- 无嵌套 > 3 层，无魔法数字（SALT_LEN/IV_LEN 等均有常量），无超 4 参数函数
**Source**：McConnell · Code Complete · Routine Cohesion
**Consequence**：无。
**Remedy**：config.ts 中 IIFE 可提取为 `safeGetConfigKey()` 辅助函数以提高可读性（🟢 Minor）。
```

### Step 4: Knowledge Duplication (R3)

```
🟢 R3 · Knowledge Duplication：无新增知识重复
**Symptom**：LEGACY_DEFAULT_PASSKEY 是唯一的新增常量，仅在 bili.ts 定义和使用。
allist.test.ts 和 stream-get/index.test.ts 的 mock 数据是测试专属，不构成概念重复。
**Source**：Hunt & Thomas · Pragmatic Programmer · DRY
**Consequence**：无。
**Remedy**：无需改动。
```

### Step 5: Accidental Complexity (R4)

```
🟡 R4 · Accidental Complexity：config.ts IIFE 可简化
**Symptom**：packages/http/src/routes/config.ts:53-59
  const serverKey =
    process.env.BILILIVE_TOOLS_BILIKEY ||
    (() => {
      try {
        return appConfig.get("biliKey");
      } catch {
        return "";
      }
    })();
IIFE 内联了 try/catch，增加了阅读负担。原因是测试 mock 了 appConfig 为 {} 导致 .get() 抛异常，
生产环境中 appConfig 永远是 AppConfig 实例。
**Source**：Brooks · No Silver Bullet · Accidental Complexity
**Consequence**：未来维护者会疑惑为什么需要 try/catch 包裹一个简单的 get 调用。
**Remedy**：将 try/catch 下移到 AppConfig 的 init() 中，确保 get() 即使未初始化也返回空字符串。
或在测试中正确 mock appConfig。🟡 Major — 建议在下次重构时处理。
```

### Step 6a: Dependency Disorder (R5)

```
🟢 R5 · Dependency Disorder：无依赖混乱
**Symptom**：检查所有新增 import：
- user.ts: "./common" → "./config" — 同级模块之间，无跨层
- config.ts (http route): 已存在 `import { appConfig } from "../index.js"`，仅新增调用
- 无循环依赖，无业务层 → 基础设施层的新增依赖
**Source**：Martin · Clean Architecture · Dependency Rule
**Consequence**：无。
**Remedy**：无需改动。
```

### Step 6b: Domain Model Distortion (R6)

```
🟢 R6 · Domain Model Distortion：无领域扭曲
**Symptom**：passKey/biliKey 概念在类型层（AppConfig.biliKey）、配置层（AppConfig.init）、
业务层（bili.ts getPassKey/getKeyCandidates）一致命名，无别名或歧义。
**Source**：Evans · Domain-Driven Design · Ubiquitous Language
**Consequence**：无。
**Remedy**：无需改动。
```

---

## 第三轮 · UI 视觉审查

**跳过**：本次变更无 `.css`/`.vue` 文件修改，`user.ts` 仅改了 import 路径不影响视觉。不触发 UI 审查条件。

---

## 第四轮 · 补充审查

### 4.1 技术债评估

**跳过**：非里程碑/季度大版本/重构项目，`.specs/CONTEXT.md` 技术债段上次更新为 2026-06-01（15 天内），不触发条件。

### 4.2 跨模型 spot-check

**跳过**：不命中触发条件（无安全/认证新增逻辑——本次是修复已有安全逻辑的回归、无并发/分布式变更、无 > 80 行新增函数、测试覆盖率上升）。

---

## 审查总结

| 轮次               | 结果                                  |
| ------------------ | ------------------------------------- |
| 第一轮 · Spec 合规 | ✅ 5/5 AC 通过，🟡 1 项日志未单测     |
| 第二轮 · 代码质量  | 🟢 4 维无发现，🟡 1 项 R4 IIFE 可简化 |
| 第三轮 · UI        | ⏭️ 跳过（无 UI 变更）                 |
| 第四轮 · 补充      | ⏭️ 跳过（不触发）                     |

**结论**：✅ 可进入 INTEGRATION。无 🔴 Critical 发现。1 个 🟡 R4 建议不阻塞合并。

---

## 跨模型分歧

_未执行跨模型 spot-check（不触发条件）。_
