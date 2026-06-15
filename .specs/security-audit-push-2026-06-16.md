# 🔐 安全审计报告 — pre-push 验证

> 审计日期：2026-06-16
> 分支：`feature/auto-clip` → `master`
> 目标：验证即将推送到 GitHub 的代码无安全与隐私泄露风险
> 审计范围：`git diff master...HEAD`（254 文件变更）
>
> **风险接受决策（2026-06-16）**：4 项 MEDIUM + 2 项 LOW 问题已由用户确认接受。
> 理由：部署环境为本地 Docker 容器，不暴露公网，攻击面极低。相关问题记录在案，后续如需公网部署再评估修复。

---

## 📊 结论总览

| 等级        | 数量 | 状态                               |
| ----------- | ---- | ---------------------------------- |
| 🔴 CRITICAL | 0    | —                                  |
| 🟠 HIGH     | 0    | —                                  |
| 🟡 MEDIUM   | 4    | 建议修复，非阻塞                   |
| 🟢 LOW      | 2    | 改进建议                           |
| ✅ 已修复   | 5    | 上轮审计的 C1/C2/C3/H1/H2 全部修复 |

**✅ 推送安全判定：可以推送。无密钥/凭证/隐私数据泄露到公开仓库的风险。**

---

## ✅ 已修复项确认（上轮审计 C1/C2/C3/H1/H2）

### C1. 硬编码 HMAC 签名密钥 → ✅ 已修复

**文件**: `packages/http/src/routes/user.ts:56`

```typescript
// 修复前（已从 git 历史中移除）:
const secret = "REDACTED_HMAC_SECRET";

// 修复后（当前代码）:
const secret = process.env.BILILIVE_TOOLS_PASSKEY || appConfig.get("passKey");
```

- 密钥来源：环境变量 → 配置文件（首次启动 `crypto.randomBytes(32)` 自动生成）
- 向后兼容：无

---

### C2. 默认加密密钥 → ✅ 已修复

**文件**: `packages/shared/src/task/bili.ts:1059-1068`

```typescript
// 修复前: const DEFAULT_PASSKEY = "7d628cb14...";  ← 已从代码中删除

// 修复后:
function getPassKey() {
  if (process.env.BILILIVE_TOOLS_BILIKEY) {
    return process.env.BILILIVE_TOOLS_BILIKEY;
  }
  const key = appConfig.get("biliKey");
  if (key) return key;
  return appConfig.getAll().biliKey || ""; // 首次启动自动生成
}
```

- ✅ `DEFAULT_PASSKEY` 硬编码值已从所有源文件中移除
- ✅ 密钥候选链支持历史 key 自动迁移（`BILILIVE_TOOLS_BILIKEY_PREV`）

---

### H1. 弱加密实现 → ✅ 已修复

**文件**: `packages/shared/src/utils/crypto.ts`

| 属性     | 修复前                       | 修复后                                       |
| -------- | ---------------------------- | -------------------------------------------- |
| 算法     | AES-256-CBC                  | AES-256-GCM                                  |
| Salt     | 固定 `"salt"`                | `crypto.randomBytes(16)`                     |
| IV       | 全零 `Buffer.alloc(16, 0)`   | `crypto.randomBytes(12)`                     |
| 认证标签 | ❌ 无                        | ✅ 16 字节 GCM auth tag                      |
| 密钥派生 | `scryptSync(pw, "salt", 32)` | `scryptSync(pw, randomSalt, 32, {N: 16384})` |
| 向后兼容 | —                            | ✅ 自动检测 `v2:` 前缀                       |

---

### H2. passKey 生成 → ✅ 已修复

**文件**: `packages/shared/src/config.ts:106-107`

```typescript
// 首次启动自动生成，可通过环境变量覆盖
APP_DEFAULT_CONFIG.passKey = crypto.randomBytes(32).toString("base64url");
APP_DEFAULT_CONFIG.biliKey = crypto.randomBytes(32).toString("hex");
```

---

### C3. Docker 硬编码默认值 → ✅ 已修复

- `docker-compose.yml`: 使用占位符 `your_passkey` / `your_bilikey`（文档性质，用户需替换）
- `docker-compose-fullstack.yml`: 密钥已注释 + 文档说明"不设置则首次启动自动生成"
- `appConfig.template.json`: `passKey: ""` — 空值，首次启动自动填充

---

## 🟡 MEDIUM — 4 项（建议修复，非阻塞推送）

### M1. `/user/get_cookie` 无速率限制

**文件**: `packages/http/src/routes/user.ts:53-80`

**现状**: HMAC 签名验证端点无任何速率限制。对比 `autoClip.ts` 有基于 IP 的 `Map<string, number>` 速率限制（30s cooldown），而 `/user/get_cookie` 完全没有。

**威胁模型**:

- 攻击者可在 10 秒时间窗口内无限尝试伪造 HMAC-SHA256 签名
- 实际利用难度极高（256 位密钥空间 + 10 秒窗口），但缺乏纵深防御

**建议**:

```typescript
// 添加与 autoClip.ts 一致的 per-IP 速率限制
const cookieRateLimit = new Map<string, number>();
const COOKIE_RATE_LIMIT_MS = 5_000; // 5s cooldown
```

**风险**: 低（实际利用不可行），但纵深防御缺失。

---

### M2. `/user/export` 返回完整加密凭证

**文件**: `packages/http/src/routes/user.ts:87-90`

```typescript
router.get("/export", async (ctx) => {
  const list = biliService.readUserList();
  ctx.body = list; // ← 返回所有用户的加密 cookie + access_token + refresh_token
});
```

**威胁模型**:

- 一次性导出所有用户的完整加密凭证
- 虽经过 AES-256-GCM 加密，但如果攻击者同时获取了导出数据 + biliKey，则全部沦陷
- 此端点受全局 passKey 认证保护（`authMiddleware`），但无额外授权确认

**建议**:

- 添加二次确认机制（如重新输入 passKey）
- 考虑分页导出而非一次性全部返回
- 记录导出操作审计日志

**风险**: 低（受 passKey 认证保护 + AES-256-GCM 加密），但单点暴露风险需关注。

---

### M3. 通知模块 SSRF 风险

**文件**: `packages/shared/src/notify.ts`

```typescript
// 用户可配置的 URL 直接传给 fetch()
sendByTg:  fetch(`${proxyUrl}/bot${key}/sendMessage`, ...)   // proxyUrl 用户可控
sendByNtfy: fetch(`${options.url}`, ...)                     // url 用户可控
sendByAllInOne: fetch(options.server, ...)                   // server 用户可控
```

**威胁模型**:

- 如果攻击者能够修改配置文件（如通过其他漏洞或社工），可注入恶意 URL
- `sendByAllInOne` 还携带 `Authorization: Bearer ${key}` header，可能泄露给恶意目标
- 实际攻击面取决于配置文件的访问控制（electron-store 文件权限）

**建议**:

- 对用户配置的 URL 做白名单/域名验证
- 至少验证 URL 协议为 `https://`
- 禁止内网 IP 段（`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`）

**风险**: 低-中（需要先攻破配置文件才能利用）。

---

### M4. 非时间恒定比较

**文件**:

- `packages/http/src/routes/user.ts:62` — `hash !== signature`
- `packages/http/src/index.ts:67` — `token !== passKey`

**现状**: 使用 JavaScript 原生 string `!==` 比较，非 `crypto.timingSafeEqual`。

**威胁模型**:

- HMAC: string 比较在首字符不匹配时短路返回，理论上可通过精确时间测量逐字节推断有效签名
- passKey: 同上，但 passKey 是随机 32 字节，同样难以利用
- 实际利用需要：1) 网络级精确时间测量（微秒级），2) 大量请求样本

**建议**:

```typescript
// user.ts
const hashBuffer = Buffer.from(hash, "hex");
const sigBuffer = Buffer.from(signature, "hex");
if (hashBuffer.length !== sigBuffer.length ||
    !crypto.timingSafeEqual(hashBuffer, sigBuffer)) {
  ctx.status = 400;
  ctx.body = "签名无效";
  return;
}

// index.ts
if (token.length !== passKey.length ||
    !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(passKey))) {
  ...
}
```

**风险**: 极低（利用条件苛刻），但属于安全最佳实践。

---

## 🟢 LOW — 2 项

### L1. 前端暴露 passKey 使用模式

**文件**: `packages/app/src/renderer/src/apis/user.ts:51-52`

```typescript
const secret = appConfig.passKey;
const signature = await generateHMACSHA256(`${uid}${timestamp}`, secret);
```

**风险**: Electron 桌面应用中的前端可以访问 passKey。如果渲染进程被 XSS 攻击（Electron 中可能性低但非零），passKey 可能被窃取。

**建议**: 考虑将 HMAC 签名生成移到 preload 桥接层，限制渲染进程对 passKey 的直接访问。

---

### L2. `docker-compose.yml` 使用弱占位符

**文件**: `docker/docker-compose.yml`

```yaml
environment:
  - BILILIVE_TOOLS_PASSKEY=your_passkey # ← 用户可能不修改就部署
  - BILILIVE_TOOLS_BILIKEY=your_bilikey
```

**对比**: `docker-compose-fullstack.yml` 已将密钥注释，首次启动自动生成 — 这是更好的模式。

**建议**: 将基础版 `docker-compose.yml` 也改为注释模式，与 fullstack 版一致。

---

## 🟢 INFO — 已确认安全的项目

- ✅ `.gitignore` 正确排除 `.env`、`*.db`、`cookies.json`、`.flow-active`、`test-results/`
- ✅ 无 SSH 私钥、SSL 证书（`.pem`/`.key`/`.p12`/`.crt`）泄露
- ✅ 无数据库连接字符串密码泄露（SQLite 文件数据库）
- ✅ 无第三方 API key 硬编码（OpenAI/阿里云等 key 均通过环境变量 `process.env.*_API_KEY` 提供）
- ✅ `example.ts` 中的 `"your-api-key"` 是占位符文档，非真实凭证
- ✅ `autoClip.ts` 有完善的 per-IP 速率限制（30s run cooldown + 10s mutation cooldown）
- ✅ webhook 内部调用使用 `http://127.0.0.1`，不暴露到外部网络
- ✅ `checkUpdate` 使用固定 GitHub URL，不可被用户注入
- ✅ 视频下载 API 调用使用各平台官方固定域名
- ✅ 邮件/通知凭证存储在加密配置文件中，不硬编码
- ✅ 前端 `security.ts` 有路径安全检查（`/dev/` + null-byte 过滤）

---

## 📋 修复优先级建议

| #   | 问题                          | 等级      | 建议修复版本      | 工作量 |
| --- | ----------------------------- | --------- | ----------------- | ------ |
| M1  | `/user/get_cookie` 无速率限制 | 🟡 MEDIUM | 下个 feature 分支 | ~20 行 |
| M4  | 非时间恒定比较                | 🟡 MEDIUM | 下个 feature 分支 | ~10 行 |
| M3  | 通知模块 SSRF                 | 🟡 MEDIUM | 下个 release      | ~30 行 |
| M2  | `/export` 全量导出            | 🟡 MEDIUM | 下个 release      | ~15 行 |
| L1  | 前端 passKey 暴露             | 🟢 LOW    | 后续优化          | ~30 行 |
| L2  | docker-compose 占位符         | 🟢 LOW    | 文档更新          | ~5 行  |

---

## 🔏 推送到 GitHub 的安全性判定

**结论：✅ 安全可推送**

- 上次审计发现的所有 🔴 CRITICAL / 🟠 HIGH 问题已在 `fix(security): remove hardcoded secrets, upgrade crypto to AES-256-GCM` (e4db89f5) 中修复
- git 历史中的硬编码密钥已通过 `chore: 归档 fix-secrets-leak` 清理
- 当前 diff 无新增密钥/凭证/隐私数据泄露
- 4 项 MEDIUM 问题均为纵深防御改进，不影响基本安全属性

**建议**: 推送后创建 Issue 跟踪 4 项 MEDIUM 问题的修复。
