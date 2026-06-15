# CHANGE — fix-docker-security-regressions

> 日期：2026-06-16
> 类型：bugfix（hotfix，跳过了 formal flow-kit 流程）
> 关联：`e4db89f5` fix(security): remove hardcoded secrets

## 背景

`e4db89f5` 安全提交移除了硬编码密钥、升级加密到 AES-256-GCM，引入了 4 个回归问题：

1. Docker 构建失败（`build:webui` exit code 2）
2. Docker 运行时 verifyBiliKey API 不读 config 文件
3. 旧 B站用户数据无法解密（缺少旧密钥回退）
4. 用户不知道登录密码（随机生成未通知）

## 改动文件

| 文件                                           | 问题                            | 修复                                 |
| ---------------------------------------------- | ------------------------------- | ------------------------------------ |
| `packages/app/src/renderer/src/apis/user.ts:3` | `import from "./common"` 错误   | → `"./config"`                       |
| `packages/http/src/routes/config.ts:53`        | `verifyBiliKey` 只读 env var    | → 回退到 `appConfig.get("biliKey")`  |
| `packages/shared/src/task/bili.ts:1070`        | `getKeyCandidates()` 缺少旧密钥 | → 添加 `LEGACY_DEFAULT_PASSKEY` 回退 |
| `packages/shared/src/config.ts:105`            | 密钥来源不透明                  | → env var 优先 + 启动日志            |
| `docker/docker-compose-fullstack.yml`          | 密钥需手动配置                  | → `env_file: .env`                   |
| `.gitignore`                                   | `.env` 未排除                   | → 添加 `.env` / `docker/.env`        |

## 新增文件

- `docker/.env`（gitignored）— 本地密钥文件模板

## 验证

- `pnpm run build:base` ✅ 全部包构建 + 类型检查
- `pnpm run --filter biliLive-tools build:webui` ✅ typecheck + electron-vite build
- `pnpm run test`（全量） ✅ 944 passed / 6 skipped / 0 failures（1 个预存 `jsdom` 环境错误，非回归）
