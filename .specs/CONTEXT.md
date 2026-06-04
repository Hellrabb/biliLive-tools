# CONTEXT.md — biliLive-tools

> 源文档：`CLAUDE.md`（项目根，3.8KB，2026-05-11 生成）
> 扫描日期：2026-06-01
> 扫描方式：综合（CLAUDE.md + 代码扫描）

## 术语表

| 术语                    | 定义                                                                                                    | 出现位置                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Recorder**            | 直播录制器实例，绑定一个房间/主播                                                                       | `packages/liveManager/src/recorder.ts`                  |
| **RecorderProvider**    | 平台录制器抽象接口，各平台实现此接口对接录制引擎                                                        | `packages/liveManager/src/index.ts`                     |
| **Preset**              | 可复用的处理参数模板（DanmuPreset / VideoPreset / FFmpegPreset / SubtitleStylePreset / AutoClipPreset） | `packages/shared/src/presets/`                          |
| **Task**                | 任务队列中的执行单元（上传/压制/弹幕转换/切片）                                                         | `packages/shared/src/task/task.ts`                      |
| **Danmu**               | 弹幕（直播弹幕数据），支持 XML 解析、转换、压制到视频                                                   | `packages/shared/src/danmu/`                            |
| **AutoClip**            | 自动切片功能：弹幕密度分析 → LLM 排序 → 视频裁剪导出                                                    | `packages/shared/src/autoClip/`                         |
| **Evidence（证据链）**  | 每个切片结果的决策证据集合：弹幕密度曲线 + 信号检测详情 + LLM 评分 + 边界精修记录 + 导出结果            | `packages/shared/src/autoClip/types.ts` (Evidence 接口) |
| **DanmakuDensityCurve** | 时间-密度数据点数组，用于前端渲染弹幕密度时序图                                                         | `Evidence.danmakuDensityCurve`                          |
| **SignalDetails**       | 信号检测阶段的判定详情：实际密度 vs 阈值、信号来源、窗口合并信息                                        | `Evidence.signalDetails`                                |
| **BoundaryRefinement**  | 边界精修的前后对比记录：原始窗口起止 → 精修后起止 + 原因                                                | `Evidence.boundaryRefinement`                           |
| **Webhook**             | 直播事件自动化处理管线                                                                                  | `packages/http/src/services/webhook/`                   |
| **StreamGet**           | 各平台直播流 URL 解析库                                                                                 | `packages/StreamGet/`                                   |
| **mesio**               | 流媒体录制引擎（外部二进制）                                                                            | CLAUDE.md:67                                            |
| **DanmakuFactory**      | 弹幕工厂（外部二进制，弹幕压制工具）                                                                    | CLAUDE.md:67                                            |
| **BililiveRecorder**    | 录播姬 CLI（外部二进制，备用录制器）                                                                    | CLAUDE.md:67                                            |
| **GlobalConfig**        | 全局配置对象，传给 `init()` 初始化整个系统                                                              | `packages/types/src/index.ts`                           |
| **AppConfig**           | 用户持久化配置（electron-store），管理 ffmpegPath 等                                                    | `packages/shared/src/config.ts`                         |

## 技术栈

| 层级        | 技术                                       | 证据                                                                |
| ----------- | ------------------------------------------ | ------------------------------------------------------------------- |
| 运行时      | Node.js 22.22.1 (ESM, `"type": "module"`)  | `package.json`（实际运行版本，非 package.json engines 声明的 24.x） |
| 包管理      | pnpm 9.15.2 (workspace monorepo)           | `pnpm-workspace.yaml`, `package.json`                               |
| 语言        | TypeScript                                 | `tsconfig.json`                                                     |
| 桌面框架    | Electron + electron-vite                   | `packages/app/electron.vite.config.ts`                              |
| 前端 UI     | Vue 3 (Composition API) + Naive UI + Pinia | `electron.vite.config.ts` (AutoImport vue/pinia/naive-ui)           |
| 前端路由    | Vue Router (hash mode)                     | CLAUDE.md:40                                                        |
| HTTP 服务   | Koa + @koa/router                          | `packages/http/src/index.ts`                                        |
| HTTP 客户端 | axios (with axios-retry)                   | `packages/shared/src/recorder/index.ts`, git log: `d0395c79`        |
| 数据库      | better-sqlite3（同步 SQLite）              | `packages/shared/package.json`, `packages/shared/src/db/`           |
| DI 容器     | awilix                                     | `packages/shared/src/index.ts:3`                                    |
| 日志        | 自研 logger（基于 winston?）               | `packages/shared/src/utils/log.ts`                                  |
| 测试        | vitest                                     | `packages/shared/test/` (`.test.ts` files, vitest runner)           |
| 构建（CLI） | rollup + pkg                               | CLAUDE.md:48                                                        |
| 代码规范    | ESLint + Prettier                          | `.eslintrc.*`, `.prettier*`                                         |
| CI          | GitHub Actions                             | `.github/workflows/`                                                |
| 容器化      | Docker + docker-compose                    | `docker/`, `docker-compose.*`                                       |

## 既有抽象索引

> 新增代码时必须复用的公共抽象。每个条目含精确路径 + 用途。

### 核心入口

| 抽象              | 路径                           | 说明                                                             |
| ----------------- | ------------------------------ | ---------------------------------------------------------------- |
| `init()`          | `packages/shared/src/index.ts` | 系统入口，创建 awilix 容器，注册所有服务，返回 `GlobalContainer` |
| `serverStart()`   | `packages/http/src/index.ts`   | Koa HTTP 服务入口，接收 DI 容器，注册所有路由                    |
| `GlobalContainer` | `packages/shared/src/index.ts` | DI 容器类型定义，列出所有注册的服务                              |
| `GlobalConfig`    | `packages/types/src/index.ts`  | 全局配置类型                                                     |

### DI 容器（awilix）

| 注册项                | 类型                                       | 路径                              |
| --------------------- | ------------------------------------------ | --------------------------------- |
| `appConfig`           | `asValue`                                  | `packages/shared/src/index.ts:63` |
| `taskQueue`           | `asValue`                                  | `packages/shared/src/index.ts:68` |
| `danmuPreset`         | `asClass(DanmuPreset).singleton()`         | `packages/shared/src/index.ts`    |
| `videoPreset`         | `asClass(VideoPreset).singleton()`         | `packages/shared/src/index.ts`    |
| `ffmpegPreset`        | `asClass(FFmpegPreset).singleton()`        | `packages/shared/src/index.ts`    |
| `subtitleStylePreset` | `asClass(SubtitleStylePreset).singleton()` | `packages/shared/src/index.ts`    |
| `autoClipPreset`      | `asClass(AutoClipPreset).singleton()`      | `packages/shared/src/index.ts:72` |
| `autoClipService`     | `asFunction`                               | `packages/shared/src/index.ts:73` |
| `recorderManager`     | `asValue`                                  | `packages/shared/src/index.ts:82` |
| `commentQueue`        | `BiliCheckQueue`                           | `packages/shared/src/index.ts`    |

DB 层另有独立容器：`packages/shared/src/db/container.ts`

### 录制器抽象

| 抽象                              | 路径                                    | 说明                                   |
| --------------------------------- | --------------------------------------- | -------------------------------------- |
| `RecorderProvider`                | `packages/liveManager/src/index.ts`     | 平台录制器抽象接口                     |
| `createRecorderManager`           | `packages/liveManager/src/index.ts`     | 录制引擎工厂函数                       |
| `createRecorderManager` (wrapped) | `packages/shared/src/recorder/index.ts` | 封装版，注入各平台 provider + 事件处理 |
| `Recorder`                        | `packages/liveManager/src/recorder.ts`  | 单个录制器实例                         |

平台 providers：

- `@bililive-tools/bilibili-recorder` — `packages/BilibiliRecorder/`
- `@bililive-tools/douyin-recorder` — `packages/DouYinRecorder/`
- `@bililive-tools/douyu-recorder` — `packages/DouYuRecorder/`
- `@bililive-tools/huya-recorder` — `packages/HuYaRecorder/`
- `@bililive-tools/xhs-recorder` — `packages/XHSRecorder/`

### 数据库

| 抽象            | 路径                                        | 说明                                                                                                                                                                   |
| --------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initDB()`      | `packages/shared/src/db/index.ts`           | 数据库初始化                                                                                                                                                           |
| `BaseModel`     | `packages/shared/src/db/model/baseModel.ts` | ORM 基类（表创建/索引/迁移）                                                                                                                                           |
| `AutoClipModel` | `packages/shared/src/db/autoClip.ts`        | auto_clip_results 表模型                                                                                                                                               |
| Service 层      | `packages/shared/src/db/service/`           | `danmuService`, `videoSubService`, `streamerService`, `statisticsService`, `recordHistoryService`, `uploadPartService`, `subtitleStyleService`, `virtualRecordService` |

### 任务队列

| 抽象             | 路径                                         | 说明                           |
| ---------------- | -------------------------------------------- | ------------------------------ |
| `TaskQueue`      | `packages/shared/src/task/task.ts`           | 统一任务队列（上传/压制/弹幕） |
| `BiliCheckQueue` | `packages/shared/src/task/BiliCheckQueue.ts` | B站稿件状态轮询                |

### HTTP 路由（全部挂在 `/api` 下）

| 路由文件      | 路径                                        | 前缀             |
| ------------- | ------------------------------------------- | ---------------- |
| webhook       | `packages/http/src/routes/webhook.ts`       | `/webhook`       |
| config        | `packages/http/src/routes/config.ts`        | `/config`        |
| recorder      | `packages/http/src/routes/recorder.ts`      | `/recorder`      |
| task          | `packages/http/src/routes/task.ts`          | `/task`          |
| bili          | `packages/http/src/routes/bili.ts`          | `/bili`          |
| video         | `packages/http/src/routes/video.ts`         | `/video`         |
| danma         | `packages/http/src/routes/danma.ts`         | `/danma`         |
| sync          | `packages/http/src/routes/sync.ts`          | `/sync`          |
| ai            | `packages/http/src/routes/ai.ts`            | `/ai`            |
| llm           | `packages/http/src/routes/llm.ts`           | `/llm`           |
| autoClip      | `packages/http/src/routes/autoClip.ts`      | `/auto-clip`     |
| preset        | `packages/http/src/routes/preset.ts`        | `/preset`        |
| common        | `packages/http/src/routes/common.ts`        | `/common`        |
| sse           | `packages/http/src/routes/sse.ts`           | `/sse`           |
| recordHistory | `packages/http/src/routes/recordHistory.ts` | `/recordHistory` |
| files         | `packages/http/src/routes/files.ts`         | `/files`         |
| assets        | `packages/http/src/routes/assets.ts`        | `/assets`        |
| user          | `packages/http/src/routes/user.ts`          | `/user`          |

### Koa 中间件

| 文件         | 路径                                        | 用途         |
| ------------ | ------------------------------------------- | ------------ |
| error.ts     | `packages/http/src/middleware/error.ts`     | 全局错误处理 |
| multer.ts    | `packages/http/src/middleware/multer.ts`    | 文件上传     |
| validator.ts | `packages/http/src/middleware/validator.ts` | 请求参数校验 |

### 工具函数（`packages/shared/src/utils/`）

| 文件                 | 用途                                                      |
| -------------------- | --------------------------------------------------------- |
| `index.ts`           | 通用工具（`replaceExtName`, `calculateFileQuickHash` 等） |
| `log.ts`             | 日志模块（`initLogger`, `setLogLevel`）                   |
| `crypto.ts`          | 加密工具                                                  |
| `combineURLs.ts`     | URL 拼接                                                  |
| `xml.ts`             | XML 解析                                                  |
| `webhook.ts`         | Webhook 工具                                              |
| `speedCalculator.ts` | 速度计算                                                  |
| `fonts.ts`           | 字体处理                                                  |

### 前端 Hooks（`packages/app/src/renderer/src/hooks/`）

| 文件                   | 用途          |
| ---------------------- | ------------- |
| `useNotice.ts`         | 通知 hook     |
| `useVisibleColumns.ts` | 表格列可见性  |
| `drive.ts`             | 网盘操作      |
| `danmuPreset.ts`       | 弹幕预设 hook |

### AutoClip 子模块

| 文件                         | 用途                                               |
| ---------------------------- | -------------------------------------------------- |
| `autoClip/types.ts`          | 类型定义 (`HighlightSegment`, `AutoClipResult` 等) |
| `autoClip/pipeline.ts`       | 弹幕分析管线 + FFmpeg 裁剪导出                     |
| `autoClip/signalDetector.ts` | 弹幕密度信号检测                                   |
| `autoClip/danmakuFilter.ts`  | 弹幕过滤                                           |
| `autoClip/llmRanker.ts`      | LLM 排序高光片段                                   |
| `autoClip/service.ts`        | AutoClip 主服务（编排）                            |
| `autoClip/sendMessage.ts`    | Webhook 通知                                       |

## 命名约定

| 约定                             | 证据                                                                  |
| -------------------------------- | --------------------------------------------------------------------- |
| 文件命名：camelCase              | `packages/shared/src/`: `autoClip/`, `musicDetector/`, `liveManager/` |
| 目录命名：camelCase              | `danmu/`, `recorder/`, `autoClip/`, `video/`（全小写，无连字符）      |
| 类型/接口：PascalCase            | `GlobalConfig`, `Recorder`, `AppConfig`, `HighlightSegment`           |
| 函数：camelCase                  | `init()`, `serverStart()`, `createRecorderManager()`                  |
| 类：PascalCase                   | `TaskQueue`, `AutoClipService`, `DanmuPreset`                         |
| 常量：UPPER_SNAKE                | `MAX_CONCURRENT_RUNS`, `RUN_RATE_LIMIT_MS`                            |
| Import 别名：`@biliLive-tools/*` | 内部包引用                                                            |
| Import 别名（前端）：`@renderer` | `packages/app/src/renderer/src`                                       |
| 测试文件：`*.test.ts`            | `packages/shared/test/`                                               |
| 构建产物：`lib/`                 | 各包的编译输出目录                                                    |

## 禁动清单

> 以下模块/文件不要随意重构或改签名——影响面大，且不属于任何单一 change 范围。

| 禁动项                                                         | 原因                                         |
| -------------------------------------------------------------- | -------------------------------------------- |
| `packages/shared/src/index.ts` 的 `init()` 签名                | 所有入口（Electron / CLI / HTTP）都依赖它    |
| `packages/liveManager/src/index.ts` 的 `RecorderProvider` 接口 | 5 个平台 recorder 全部实现此接口             |
| `packages/types/src/index.ts` 的 `GlobalConfig` 类型           | 跨所有包共享                                 |
| `packages/shared/src/db/model/baseModel.ts`                    | 所有 DB model 继承它                         |
| `packages/http/src/middleware/error.ts`                        | 全局错误处理中间件                           |
| `packages/shared/src/config.ts` 的 `AppConfig`                 | electron-store 持久化配置，schema 变更需迁移 |
| `packages/shared/src/presets/` 各 Preset 类                    | 预设系统被前端/CLI/autoClip 多处使用         |
| 外部二进制接口（FFmpeg/FFprobe/DanmakuFactory/mesio）          | 用户手动配置的路径，不能改参数约定           |

## 构建顺序

```
types → shared → (http, liveManager, 各 recorder) → (app / CLI)
```

`pnpm run build:base` 执行 types + shared + http + 各 recorder 的构建。

## 禁动清单

> 以下依赖已确认为未使用，下次清理窗口移除。AI 不应在新代码中导入这些包。

| 依赖                  | 所在包      | 确认日期   | 状态      |
| --------------------- | ----------- | ---------- | --------- |
| `arktype`             | shared      | 2026-06-05 | 🟡 待移除 |
| `cli-progress`        | http        | 2026-06-05 | 🟡 待移除 |
| `@types/cli-progress` | http        | 2026-06-05 | 🟡 待移除 |
| `fs-extra`            | liveManager | 2026-06-05 | 🟡 待移除 |

> 以下编码约束同样属于禁动规则：

| 规则                             | 说明                                                      | 来源                                |
| -------------------------------- | --------------------------------------------------------- | ----------------------------------- |
| 禁止 `JSON.parse(evidence)` 裸调 | evidence 字段可能为 null/损坏，必须走 `parseEvidenceSafe` | autoclip-evidence-chain DESIGN §9.5 |

## 已知技术债 / 注意事项

- 无自定义 Error 类（`grep "class.*Error" shared/src/` 为空）——错误处理依赖 try/catch + 字符串
- 测试覆盖不均衡：`packages/shared/test/` 有测试，但 recorder 包未见测试文件
- `packages/http/src/routes/autoClip.ts` 直接 import DI container（`import { container } from "../index.js"`），耦合较紧
- 部分包使用 `lib/` 作为构建产物（与 `src/` 并存），构建前必须先 `build:base`
- better-sqlite3 原生模块版本不匹配（NODE_MODULE_VERSION 143 vs 127），需 `pnpm rebuild better-sqlite3`（2026-06-05 巡检发现）
- ESLint 配置损坏（`.eslintrc.cjs` 中 `@vue/eslint-config-typescript` 子路径导出问题）（2026-06-05 巡检发现）
- 无测试覆盖率工具（`@vitest/coverage-v8` 未安装）（2026-06-05 巡检发现）
- `exportPipeline.ts` (566行) 职责过多，待拆分为 pathResolver + executor + retryManager（2026-06-05 巡检建议）
- `files.ts` 路由内部路径校验逻辑重复（7-10行 × 2），待提取 `validateFilePath()` 公共函数（2026-06-05 巡检建议）
