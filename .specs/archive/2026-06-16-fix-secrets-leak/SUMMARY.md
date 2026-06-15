# SUMMARY — fix-secrets-leak

> 归档日期：2026-06-16
> 来源：安全审计 `.specs/security-audit-2026-06-15.md`
> 分支：`feature/auto-clip`

## 背景

2026-06-15 安全审计发现 8 项安全问题，其中 5 项高中危涉及硬编码密钥和弱加密实现。

## 修复内容

### v1（2026-06-16，commit `e9cce872`）

| 编号 | 问题                                        | 修复                                                             |
| ---- | ------------------------------------------- | ---------------------------------------------------------------- |
| C1   | `user.ts` 硬编码 HMAC secret                | 改为从 `appConfig.passKey` / `BILILIVE_TOOLS_PASSKEY` 读取       |
| C2   | `bili.ts` 硬编码 DEFAULT_PASSKEY            | 首次启动自动生成 `biliKey`，可通过 `BILILIVE_TOOLS_BILIKEY` 覆盖 |
| C3   | `docker-compose-fullstack.yml` 硬编码默认值 | 改为注释环境变量模板，不设默认值                                 |
| H1   | AES-256-CBC 零IV + 固定盐 + 无认证          | 重写为 AES-256-GCM，随机盐/IV，GCM 认证标签，scrypt N=16384      |
| H2   | `Math.random()` 生成 passKey                | 改为 `crypto.randomBytes(32)`                                    |

### v1.1（2026-06-16，git history scrub）

- 使用 `git filter-branch` 清理 3186 个提交中的旧密钥字符串
- 旧 biliKey (64位hex) → `REDACTED_OLD_BILIKEY`
- 旧 Docker pass (短字符串) → `REDACTED_OLD_DOCKER_PASS`
- Force push 覆盖 `origin/feature/auto-clip`

### v2（待做）

| 编号 | 问题                                                  | 优先级 |
| ---- | ----------------------------------------------------- | ------ |
| H3   | 认证中间件无暴力破解防护（速率限制）                  | HIGH   |
| M1   | `/api/user/get_cookie` 端点 10s 时间窗口 + 无速率限制 | MEDIUM |
| M2   | `/api/user/export` 返回完整 BiliUser 凭证，无额外鉴权 | MEDIUM |

## 涉及文件

- `packages/shared/src/utils/crypto.ts` — 加密实现重写
- `packages/shared/src/config.ts` — passKey/biliKey 自动生成
- `packages/shared/src/task/bili.ts` — 密钥读取逻辑
- `packages/http/src/routes/user.ts` — HMAC 签名密钥来源
- `packages/http/src/index.ts` — 认证中间件（v2 待加固）
- `docker/docker-compose-fullstack.yml` — 默认值清理
- `packages/app/src/renderer/src/apis/user.ts` — 前端签名逻辑
- `docs/api/user.md` — API 文档更新

## 测试

- 944 个已有测试全部通过，无回归
- 向后兼容：旧 CBC 加密数据自动检测并迁移

## 安全验证（2026-06-16 二次审计）

- ✅ 源码中无硬编码密钥
- ✅ Docker Compose 无默认密码
- ✅ 加密实现使用 AES-256-GCM + 随机 salt/IV
- ✅ 密钥生成使用 `crypto.randomBytes`（非 `Math.random`）
- ✅ Git 远程历史中旧密钥已替换为 REDACTED 占位符
- ✅ `localhost`/`127.0.0.1` 引用均为正常本地开发配置
- ✅ 无私钥文件（.pem/.key/.crt）泄露
- ✅ 无 .env 文件提交
- ✅ Build 产物（out/, lib/）已 gitignore
- ✅ `/api/user/list` 端点正确脱敏（仅返回 uid/name/face/expires）
