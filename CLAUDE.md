# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

biliLive-tools 是一个直播一站式工具，支持多平台直播录制（B站、斗鱼、虎牙、抖音、小红书）、弹幕转换与压制、视频上传B站、webhook自动化处理、视频切片等功能。

## 常用命令

```bash
# 安装依赖（Node 24.10.0, pnpm 9.15.2）
pnpm install && pnpm run install:bin

# 启动 Electron 桌面应用开发
pnpm run dev

# 构建基础包（shared、types、http、各 recorder 等）
pnpm run build:base

# 构建 Electron 桌面应用
pnpm run build:app

# 构建 CLI
pnpm run build:cli

# 运行所有测试
pnpm run test

# 在特定包中运行测试
cd packages/shared && pnpm run test
cd packages/http && pnpm run test
cd packages/liveManager && pnpm run test
```

## 架构

### 包结构（pnpm monorepo）

- **`packages/app/`** — Electron 桌面应用。`src/main/` 是主进程（awilix DI容器初始化，IPC handlers），`src/renderer/` 是 Vue 3 渲染进程（Naive UI 组件库，Vue Router hash 路由），`src/preload/` 是预加载桥接脚本。使用 `electron-vite` 构建。
- **`packages/shared/`** — 核心业务逻辑层。通过 `init(GlobalConfig)` 函数初始化系统，内部使用 awilix DI 容器注册 `appConfig`、`taskQueue`、`recorderManager`、presets 等单例。涵盖：配置管理、任务队列（上传/压制/弹幕）、录制管理器、弹幕处理、视频处理、数据库、通知、网盘同步、LLM/AI 功能。
- **`packages/http/`** — Koa HTTP 服务器。为前端 WebUI 和外部 webhook 提供 REST API。路由包括 webhook、config、recorder、task、bili、video、danma、sync、ai 等。支持 passkey 认证中间件。
- **`packages/types/`** — 共享 TypeScript 类型定义（`GlobalConfig`、`Recorder`、`Task` 等）。
- **`packages/liveManager/`** — 直播录制引擎核心（forked from LiveAutoRecord）。定义 `RecorderProvider` 抽象和 `createRecorderManager`，各平台 recorder 通过实现 provider 接口对接。
- **`packages/BilibiliRecorder/`、`DouYinRecorder/`、`DouYuRecorder/`、`HuYaRecorder/`、`XHSRecorder/`** — 各平台的录制器实现，各自实现 `RecorderProvider` 接口，依赖 `@bililive-tools/manager`。
- **`packages/StreamGet/`** — 直播流地址解析库，从各平台 API 提取实际流 URL。
- **`packages/CLI/`** — 命令行工具，使用 rollup 构建，pkg 打包为独立可执行文件。
- **`packages/DouYinDanma/`、`packages/huya-danmu/`** — 平台特定的弹幕监听模块（WebSocket 连接）。

### 依赖注入

`packages/shared/src/index.ts` 的 `init()` 函数创建 awilix 容器，注册所有核心服务。`packages/http/src/index.ts` 的 `serverStart()` 接收容器并初始化 Koa 路由。Electron 主进程在 `packages/app/src/main/index.ts` 中同时调用两者。

### 构建顺序

由于包之间存在依赖关系，构建必须按顺序执行：先 `types` 和 `shared`，再 `http` 和各 recorder，最后 `app` 或 `CLI`。根 `package.json` 的 `build:base` 脚本定义了正确的构建顺序。

### 数据库

使用 better-sqlite3（同步 SQLite），数据库文件位于用户数据目录。`packages/shared/src/db/` 管理数据库初始化和 schema。

### 配置系统

`packages/shared/src/config.ts` 中的 `AppConfig` 使用 electron-store 持久化用户配置。预设系统（DanmuPreset、VideoPreset、FFmpegPreset、SubtitleStylePreset）管理可复用的处理参数模板。

### 外部二进制依赖

运行时依赖以下外部可执行文件，需用户自行下载并在设置中配置路径：FFmpeg、FFprobe、DanmakuFactory、mesio（流媒体录制引擎）、BililiveRecorder CLI（录播姬）、audiowaveform。
