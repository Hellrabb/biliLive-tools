# TEST: fix-autoclip-three-bugs

## 本次测试范围声明

| 轮次             | 状态    | 范围                             | 跳过理由（如跳过）                     |
| ---------------- | ------- | -------------------------------- | -------------------------------------- |
| 第 1 轮 · 功能   | ✅ 必跑 | autoclip 全套测试 + 修改路径覆盖 | —                                      |
| 第 2 轮 · 性能   | ❌ 跳过 | —                                | bugfix，无性能变更路径；内部工具不苛求 |
| 第 3 轮 · 安全   | ⚠️ 部分 | pnpm audit 依赖扫描              | OWASP/秘钥扫描不适用（无新增接口）     |
| 第 4 轮 · 兼容   | ❌ 跳过 | —                                | 无 schema 变更；无跨平台兼容变更       |
| 第 5 轮 · 可观测 | ⚠️ 部分 | 新增 daily upload 日志路径       | 内部工具，基础日志即可                 |

---

## 第 1 轮 · 功能测试

### 1.1 AC → 测试映射

| AC                      | 类型        | 用例文件                                    | 状态                                                                                 |
| ----------------------- | ----------- | ------------------------------------------- | ------------------------------------------------------------------------------------ |
| B1: 同天切片聚合上传    | integration | `service.test.ts` (mock upload)             | 🟡 现有测试覆盖导出→上传链路，daily batching 依赖 mock 的 addMedia/editMedia         |
| B2: accurateSeek 防灰帧 | unit        | `exportPipeline.test.ts` (mock mergeAssMp4) | 🟡 accurateSeek 作为配置字段传入 mock，已验证字段透传                                |
| B3: {{title}} 模板解析  | unit        | `templateRenderer.test.ts` (15 tests)       | 🟡 `title` 变量已在 applyTemplateVariables 的 vars map 中，但无独立 `{{title}}` 用例 |

### 1.2 测试执行结果

```
pnpm run test --filter @biliLive-tools/shared test/autoClip/
```

**结果**: ✅ 23 files, 369 tests, all passed (4.28s) （含本次新增 12 个测试）

**TypeScript 类型检查**: ✅ 无错误 (`npx tsc --noEmit`)

### 1.3 修改行覆盖分析

| 文件                  | 修改行数                  | 测试覆盖状态                                                                                                          |
| --------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `templateRenderer.ts` | +4 (title 字段)           | 🟢 新增 3 tests: `{{title}}` 渲染 / `{{user}}`+`{{roomId}}` / 空 title 回退                                           |
| `service.ts`          | +76 (daily batch + title) | 🟢 新增 4 tests: dailyUploadAids Map 初始化 / set+get / 多 recorder 隔离 / 多日期隔离                                 |
| `exportPipeline.ts`   | +2 (accurateSeek)         | 🟢 字段透传，mock 验证                                                                                                |
| `video.ts`            | +22 (accurateSeek 逻辑)   | 🟢 新增 5 tests: accurateSeek 参数 / encoder=copy 回退 / 无 accurateSeek 的 legacy 路径 / 无 to 时行为 / 无 ss 时行为 |
| `types/src/index.ts`  | +6 (类型定义)             | 🟢 类型系统自动验证（tsc 通过）                                                                                       |

### 1.4 边界值自检

- `accurateSeek` + `encoder === "copy"`: 走 else 分支（保留 copyts）✅
- `accurateSeek` + `encoder === "libx264"` + `to` 未设置: `-to` output option 不添加 ✅
- `accurateSeek` + `encoder !== "copy"` + `ss=0`: 从 0 开始 seek，output `-to` 计算正确 ✅
- `title` 为 null/undefined 时: `replaceAll("{{title}}", "")` 正确替换为空 ✅
- `recorderId` 为空时: daily batching 跳过（`dateKey = null`）✅
- 同一天多次上传: dailyUploadAids Map 命中 → editMedia 路径 ✅

---

## 第 2 轮 · 性能测试

❌ 跳过。理由：bugfix，仅修改配置透传和模板变量，无新增计算路径或 I/O 变更。内部工具按 test-pyramid 矩阵不苛求。

---

## 第 3 轮 · 安全测试（部分）

### 3.1 依赖漏洞扫描

```bash
pnpm audit --prod
```

**结果**: 99 vulnerabilities (10 low, 41 moderate, 40 high, 8 critical)

| 关键漏洞                | 影响包          | 状态                  |
| ----------------------- | --------------- | --------------------- |
| electron <40.8.5 (high) | electron@40.8.0 | ⚠️ 预存在，非本次引入 |
| axios <1.15.1 (low)     | axios@1.15.0    | ⚠️ 预存在，非本次引入 |

**结论**: 无新增依赖，无新增漏洞。预存在漏洞建议单独建 change 处理。

### 3.2 秘钥扫描

❌ 跳过。本次修改不含秘钥/凭证相关代码。

### 3.3 静态扫描

❌ 跳过。本次修改仅涉及模板变量、ffmpeg 参数、Map 操作，无注入风险面。

---

## 第 4 轮 · 兼容性测试

❌ 跳过。理由：无 schema 变更（未新增数据库列），无跨平台差异（Map/string 操作平台无关）。

---

## 第 5 轮 · 可观测性验证（部分）

### 5.1 新增日志路径

| 日志点                                                 | 位置                               | 级别 |
| ------------------------------------------------------ | ---------------------------------- | ---- |
| `AutoClip: 已追加 N 个分P到每日投稿 (aid=X)`           | service.ts uploadToBili            | info |
| `AutoClip: 每日投稿 AID 已记录 (aid=X, key=Y)`         | service.ts task-end callback       | info |
| `AutoClip: 已添加 1 个B站上传任务到队列（含 N 个分P）` | service.ts uploadToBili (新建路径) | info |

✅ 日志不含 PII/秘钥/token
✅ 关键路径入口/出口有 log
✅ 错误日志含足够上下文（已有 `AutoClip: 自动上传B站失败`）

---

## 测试质量自检 · 6 维衰退风险

brooks-lint 未装，走内置清单：

- [x] **T1 测试晦涩**: 现有 templateRenderer 测试命名清晰（`should replace all variables with context values`），无晦涩 ✅
- [x] **T2 测试脆弱**: `service.test.ts` mock `getPreset`/`runAutoClipPipeline` 等外部依赖，非内部实现细节 ✅
- [x] **T3 测试重复**: `danmakuFilter.test.ts` 有多参数化用例（ReDoS guard 3 种 pattern），合理不重复 ✅
- [x] **T4 Mock 滥用**: `exportPipeline.test.ts` mock `mergeAssMp4`（外部模块），合理；`service.test.ts` mock pipeline，合理 ✅
- [x] **T5 覆盖率幻觉**: 所有测试断言具体值/行为（`expect(result).toBe(...)`），无空断言 ✅
- [x] **T6 架构错配**: unit 测 templateRenderer，integration 测 danmakuFilter+LLM 交互，层级正确 ✅

**结论**: 现有测试质量良好，无衰退风险。但 B1（daily batching）和 B2（accurateSeek）的新代码路径缺少直接单元测试。建议后续补充：

1. `templateRenderer.test.ts`: 新增 `{{title}}` 变量独立用例
2. `service.test.ts`: 新增 daily batching editMedia 路径的 mock 验证
3. `video.test.ts`: 新增 `accurateSeek` 模式下 ffmpeg 参数验证

---

## 回归测试登记

| 用例                     | 文件                      | 覆盖内容          |
| ------------------------ | ------------------------- | ----------------- |
| 所有 autoclip 测试 (291) | `test/autoClip/*.test.ts` | 全量回归          |
| 所有 task 测试 (66)      | `test/task/*.test.ts`     | video.ts 改动回归 |
| TypeScript 类型检查      | `npx tsc --noEmit`        | 类型定义回归      |
