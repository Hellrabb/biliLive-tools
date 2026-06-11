# TEST: autoclip B站上传改为同一稿件分P

- **Change ID**: `autoclip-bili-part-upload`
- **关联**: `@.specs/autoclip-bili-part-upload/REQUIREMENT.md`、`@.specs/autoclip-bili-part-upload/DESIGN.md`、`@.specs/autoclip-bili-part-upload/TASK.md`

---

## 本次测试范围声明

| 轮次             | 状态    | 范围         | 跳过理由                                                        |
| ---------------- | ------- | ------------ | --------------------------------------------------------------- |
| 第 1 轮 · 功能   | ✅ 必跑 | 全部 5 条 AC | —                                                               |
| 第 2 轮 · 性能   | ❌ 跳过 | —            | 纯行为重构：N 次 addMedia → 1 次，性能提升，无新增计算/IO 路径  |
| 第 3 轮 · 安全   | ❌ 跳过 | —            | 无认证/权限/输入变更；无新增依赖；不涉及秘钥处理                |
| 第 4 轮 · 兼容   | ❌ 跳过 | —            | 无 schema 变更、无 API 序列化变更、无跨版本兼容问题             |
| 第 5 轮 · 可观测 | ⚠️ 部分 | 日志文案验证 | 日志行从 "已添加 N 个" 变为 "已添加 1 个（含 N 个分P）"，需确认 |

---

## 第 1 轮 · 功能测试（Functional）

### 1.1 测试矩阵

所有 AC 为手工 UAT（需要完整 B站上传环境：API key + 视频文件 + 网络）。

| AC                            | 类型   | 用例编号 | 状态          |
| ----------------------------- | ------ | -------- | ------------- |
| AC-1 多切片聚合为单稿件多P    | manual | UAT-1    | 🟡 待手工验证 |
| AC-2 稿件主标题 titleTemplate | manual | UAT-2    | 🟡 待手工验证 |
| AC-3 分P标题                  | manual | UAT-3    | 🟡 待手工验证 |
| AC-4 封面                     | manual | UAT-4    | 🟡 待手工验证 |
| AC-5 单切片降级               | manual | UAT-5    | 🟡 待手工验证 |

### 1.2 自动化验证（可执行）

| 验证项              | 命令                                     | 结果                           |
| ------------------- | ---------------------------------------- | ------------------------------ |
| TypeScript 类型检查 | `cd packages/shared && npx tsc --noEmit` | ✅ 通过                        |
| 现有测试回归        | `cd packages/shared && npx vitest run`   | ✅ 34 files / 516 tests passed |

### 1.3 UAT 脚本

```
UAT-1：多切片聚合为单稿件多P
  前置：
    - B站账号已登录，uid 已配置
    - autoclip preset 已配置（export.uploadToBili = true）
    - 已有一场直播录制视频（含弹幕），autoClip 产生了 ≥ 2 个高光片段
  步骤：
    1. 启动应用，等待该录制文件的 autoClip 自动分析完成
    2. 观察日志：查找 "AutoClip:" 前缀的导出和上传日志
    3. 打开 B站创作中心，查看稿件列表
  期望：
    - 日志显示 "已添加 1 个B站上传任务到队列（含 N 个分P）"（N = 切片数）
    - B站创作中心出现 1 个新稿件（而非 N 个）
    - 稿件内包含 N 个分P
  通过/失败：

UAT-2：稿件主标题用 titleTemplate
  前置：
    - autoclip preset 的 biliUpTemplate.titleTemplate = "{{roomName}} {{date}} 直播切片"
    - 同 UAT-1 的录制视频和切片
  步骤：
    1. 重复 UAT-1 步骤
    2. 查看 B站稿件的标题
  期望：
    - 稿件标题 = "<房间名> <当前日期> 直播切片"
    - 变量已正确替换（非原始 {{roomName}} 模板字符串）
  通过/失败：

UAT-3：分P标题 —— 默认用 highlight.title
  前置：
    - 同 UAT-1
    - partTitleTemplate 未配置（或为空）
  步骤：
    1. 查看稿件中各分P的标题
  期望：
    - 每个分P标题 = 对应切片的 highlight.title（如 "精彩团战"、"极限反杀"）
  通过/失败：

UAT-3b：分P标题 —— partTitleTemplate 模板
  前置：
    - autoclip preset 的 biliUpTemplate.partTitleTemplate = "{{highlightTitle}} - P{{index}}"
    - 注意：当前 v1 不支持 {{index}}，仅支持 {{highlightTitle}}/{{roomName}}/{{date}}/{{uploadDate}}
  步骤：
    1. 查看稿件中各分P的标题
  期望：
    - 每个分P标题按模板渲染（如 "精彩团战 - P{{index}}" → 实际 "精彩团战 - P{{index}}"）
    - 未识别的变量原样保留
  通过/失败：

UAT-4：封面 —— 第一个切片自动截帧
  前置：
    - cover 未手动配置（biliUpTemplate.cover 为空）
    - 同 UAT-1
  步骤：
    1. 查看 B站稿件的封面
  期望：
    - 封面是从第一个切片的 bestRange 中点截取的画面帧
    - 封面路径：<第一个切片导出目录>/<切片名>_autoclip_cover.jpg
  通过/失败：

UAT-5：单切片场景降级为单P
  前置：
    - autoClip 只产生了 1 个高光片段
    - 其他配置同上
  步骤：
    1. 触发自动导出和上传
    2. 查看日志和 B站稿件
  期望：
    - 日志显示 "已添加 1 个B站上传任务到队列（含 1 个分P）"
    - 稿件正常创建，包含 1 个分P（即单P视频）
    - 无报错、无跳过
  通过/失败：
```

### 1.4 覆盖率与边界

本项目 autoclip 模块无独立单元测试，行覆盖率不计入本次要求（v2 可考虑补齐）。

边界用例：

- exportedResults 为空数组：调用方 `autoExportAndUpload` L352 已检查 `success.length > 0`，不会传入空数组 ✅
- highlight.title 为 null/undefined：回退到 `path.parse(expPath).name`（文件名）✅
- 第一个切片 bestRange 为 undefined：回退到 `highlight.timeRange` ✅

### 1.5 测试质量自检 · 6 维测试衰退风险

brooks-lint 已装但 brooks-test skill 需 CLI binary（不可用）。走内置清单。

| 维度          | 检查                                                   | 结果 |
| ------------- | ------------------------------------------------------ | ---- |
| T1 测试晦涩   | 本次新增为手工 UAT，Given/When/Then 结构清晰           | ✅   |
| T2 测试脆弱   | UAT 验证外部行为（B站稿件），不绑内部实现              | ✅   |
| T3 测试重复   | 5 条 UAT 各覆盖独立 AC，无重复                         | ✅   |
| T4 Mock 滥用  | 无 mock——UAT 在真实环境                                | ✅   |
| T5 覆盖率幻觉 | N/A——无单元测试覆盖率数据，UAT 验证真实效果            | ✅   |
| T6 架构错配   | UAT 对应用层行为验证正确（端到端），不做单元级过度测试 | ✅   |

---

## 第 2 轮 · 性能测试（Performance）

**跳过**。理由：从逐切片 N 次 `addMedia` 改为 1 次批量调用，是性能改善（减少 N-1 次 HTTP 往返）。无新增计算/IO 瓶颈路径。非功能性需求明确标注"性能：无"。

---

## 第 3 轮 · 安全测试（Security）

**跳过**。理由：无认证/鉴权变更（uid 沿用），无新增依赖（零 npm install 变更），无输入校验新增（filePath 由 exportClips 产出），不涉及秘钥/token 处理。原有 `npm audit` 不在本次 change 范围。

---

## 第 4 轮 · 兼容性测试（Compatibility）

**跳过**。理由：无数据库 schema 变更、无 API 序列化格式变更、无跨版本数据兼容问题。`addMedia` 接口的 `filePath[]` 参数签名未变（仅从单元素数组变为多元素数组，均为合法调用）。

---

## 第 5 轮 · 可观测性验证（Observability）

### 5.1 日志验证

| 检查项              | 结果                                                                             |
| ------------------- | -------------------------------------------------------------------------------- |
| 关键路径入口有 log  | ✅ `logger.info("AutoClip: 自动导出 N 个切片...")` 在 `autoExportAndUpload` L334 |
| 关键路径出口有 log  | ✅ 改为 `logger.info("AutoClip: 已添加 1 个B站上传任务到队列（含 N 个分P）")`    |
| 异常有 log          | ✅ `logger.error("AutoClip: 自动上传B站失败", uploadError)`                      |
| 不含 PII/秘钥/token | ✅ 日志仅含切片数量、文件路径（无密钥）                                          |
| 错误含足够上下文    | ✅ `uploadError` 完整传入 logger.error                                           |

### 5.2 指标/追踪

N/A——本项目无 metrics/tracing 基础设施。

### 5.3 告警 + 健康检查

N/A——本项目无运行时告警系统。通知通过 `sendNotify`（L370-374），本次未修改。

---

## 回归测试登记

| 用例                                 | 类型   | 关联 AC  |
| ------------------------------------ | ------ | -------- |
| TypeScript type check                | 自动化 | AC-1~5   |
| 现有测试回归（34 files / 516 tests） | 自动化 | 全局回归 |
| UAT-1 ~ UAT-5                        | 手工   | AC-1~5   |

---

## 测试结论

| 轮次             | 结果                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| 第 1 轮 · 功能   | ✅ TypeScript 编译通过 + 现有 516 测试回归通过 + 5 条 UAT 待手工验证 |
| 第 2 轮 · 性能   | ⏭️ 跳过                                                              |
| 第 3 轮 · 安全   | ⏭️ 跳过                                                              |
| 第 4 轮 · 兼容   | ⏭️ 跳过                                                              |
| 第 5 轮 · 可观测 | ✅ 日志验证通过                                                      |

**总体**：自动化验证通过。5 条 UAT 需要在有 B站上传环境的机器上手工跑。无阻塞性问题。
