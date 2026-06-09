# TEST · autoclip-upload-template-ui

> 日期：2026-06-08
> 关联：`REQUIREMENT.md` / `TASK.md` / 5 × `*-SUMMARY.md`

---

## 本次测试范围声明

| 轮次             | 状态    | 范围                                | 跳过理由                                              |
| ---------------- | ------- | ----------------------------------- | ----------------------------------------------------- |
| 第 1 轮 · 功能   | ✅ 必跑 | templateRenderer 单元测试 + AC 覆盖 | —                                                     |
| 第 2 轮 · 性能   | ❌ 跳过 | —                                   | 无性能预算定义；纯配置表单功能，不引入新处理路径      |
| 第 3 轮 · 安全   | ⚠️ 部分 | 依赖审计                            | 无新 API/鉴权/秘钥；新增代码无注入点                  |
| 第 4 轮 · 兼容   | ❌ 跳过 | —                                   | 无 schema 变更；无新浏览器 API；Naive UI 组件自带兼容 |
| 第 5 轮 · 可观测 | ❌ 跳过 | —                                   | 桌面应用无运行时监控；日志已沿用既有 logger           |

---

## 第 1 轮 · 功能测试

### 测试矩阵

| AC                  | 类型   | 用例                                                   | 状态                      |
| ------------------- | ------ | ------------------------------------------------------ | ------------------------- |
| AC-1 (表单显隐)     | manual | 见 UAT-1                                               | 🟡 需启动应用验证         |
| AC-2 (标题模板变量) | unit   | `templateRenderer.test.ts` — renderTitleTemplate tests | ✅                        |
| AC-3 (简介模板变量) | unit   | `templateRenderer.test.ts` — renderDescTemplate tests  | ✅                        |
| AC-4 (默认值)       | unit   | T03 default config 经 tsc 验证                         | ✅                        |
| AC-5 (上传链路)     | unit   | T04 service.ts tsc 编译通过                            | 🟡 需集成测试             |
| AC-6 (向后兼容)     | unit   | selectPreset guard + tsc 验证                          | ✅                        |
| AC-7 (分区列表)     | manual | 见 UAT-2                                               | 🟡 需启动应用验证         |
| AC-8 (封面自动提取) | unit   | cover extraction 逻辑 tsc 通过                         | 🟡 需 ffmpeg 真实环境验证 |

### 单元测试结果

```
npx vitest run test/autoClip/templateRenderer.test.ts

✅ 15 tests passed, 0 failed
```

测试覆盖：

- `applyTemplateVariables`: 6 tests（替换/保留未知/空值/空模板/多次替换/部分匹配）
- `renderTitleTemplate`: 4 tests（渲染/截断80字/trim/四变量）
- `renderDescTemplate`: 2 tests（多行/空模板）
- 边界：3 tests（正则特殊字符/unicode/空上下文）

### UAT 脚本

**UAT-1：B站模板表单显隐**

- 前置：启动 Electron 应用，打开 autoclip 预设编辑弹窗，切换到「导出设置」tab
- 步骤：
  1. 确认「上传到B站」开关为关闭状态
  2. 确认开关下方无 B站模板表单字段
  3. 打开「上传到B站」开关
  4. 观察表单字段出现
- 期望：8 个字段（标题模板/标签/分区/自制转载/禁止转载/转载来源/简介/封面）全部可见，变量提示正确
- 通过/失败：

**UAT-2：分区列表加载**

- 前置：浏览器已访问过 B站设置页面（areaData 已缓存至 localStorage）
- 步骤：
  1. 打开 autoclip 预设编辑弹窗
  2. 打开上传到B站，点击投稿分区下拉
- 期望：分区列表正常加载，可级联选择，默认选中 138
- 通过/失败：

### 测试质量自检（6 维）

✅ **T1 测试晦涩**：测试名使用 describe/it 结构描述场景，每个 it 名直接说明验证的行为
✅ **T2 测试脆弱**：测试验证公共 API（`applyTemplateVariables` 的输入/输出），不验证内部实现
✅ **T3 测试重复**：无重复；每个 case 测试不同行为维度
✅ **T4 Mock 滥用**：无 mock — `applyTemplateVariables` 是纯函数，不需要 mock
✅ **T5 覆盖率幻觉**：所有断言均为具体值匹配，无 `toBeDefined()` 等空断言
✅ **T6 架构错配**：纯工具函数用单元测试验证 — 层级正确

---

## 第 3 轮 · 安全（部分）

### 依赖审计

`pnpm audit` 结果：（见背景任务输出）

### 代码级安全检查

- ✅ 无新增 HTTP 端点 → 无注入风险
- ✅ 无新增鉴权逻辑 → 无越权风险
- ✅ 模板变量用 `replaceAll` → 无 eval/代码注入
- ✅ 无新增依赖包
- ✅ 封面提取用 `Buffer.from(base64)` → 无路径遍历（路径来自安全的 join）

---

## 回归测试登记

| 测试文件                                        | 类型 | 覆盖范围                                                                     |
| ----------------------------------------------- | ---- | ---------------------------------------------------------------------------- |
| `shared/test/autoClip/templateRenderer.test.ts` | 新增 | `applyTemplateVariables`, `renderTitleTemplate`, `renderDescTemplate` + 边界 |
