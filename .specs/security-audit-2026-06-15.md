# 🔒 安全隐私审计报告 — biliLive-tools

> 审计日期：2026-06-15
> 审计范围：全仓库（`feature/auto-clip` 分支，已推送至 `git@github.com:Hellrabb/biliLive-tools.git`）
> 审计方法：多维度并行扫描（密钥/凭证/加密实现/隐私数据/配置安全/Docker安全/git历史）

---

## 风险等级说明

| 等级          | 含义                                          |
| ------------- | --------------------------------------------- |
| 🔴 CRITICAL   | 已泄露到公开仓库的密钥/凭证，攻击者可立即利用 |
| 🟠 HIGH       | 加密实现存在严重缺陷，数据保护形同虚设        |
| 🟡 MEDIUM     | 安全机制存在可被绕过的薄弱环节                |
| 🟢 LOW / INFO | 改进建议，暂不构成直接威胁                    |

---

## 🔴 CRITICAL — 3 项（必须立即处理）

### C1. 硬编码 HMAC 签名密钥 — 可伪造签名窃取 B站 Cookie

**文件**: `packages/http/src/routes/user.ts:55`

```typescript
const secret = "REDACTED_HMAC_SECRET";
const hash = crypto.createHmac("sha256", secret).update(`${uid}${timestamp}`).digest("hex");
```

**影响**:

- `/api/user/get_cookie` 端点的 HMAC-SHA256 签名密钥直接写在源代码中
- **任何人阅读 GitHub 公开仓库即可获取此密钥**
- 攻击者可伪造有效签名，绕过时间戳+签名双重校验
- 成功利用后可获取任意 uid 对应的完整 B站 Cookie（含 `SESSDATA`、`bili_jct`、`access_token`、`refresh_token`）
- 攻击面：如果 HTTP 服务暴露在非 localhost 网络接口，可被远程攻击

**修复**:

- 立即轮换密钥，改为从环境变量 `process.env.BILILIVE_TOOLS_COOKIE_SECRET` 读取
- 如果环境变量未设置，**禁止启动** 或对该端点返回 500
- 考虑是否需要将此端点改为仅 localhost 访问

---

### C2. 硬编码默认加密密钥 — B站用户凭证可被解密

**文件**: `packages/shared/src/task/bili.ts:1056`

```typescript
const DEFAULT_PASSKEY = "REDACTED_DEFAULT_PASSKEY";
```

**影响**:

- 这是加密 B站用户数据（`accessToken`、`refreshToken`、`cookie`）的默认密钥
- 任何未设置 `BILILIVE_TOOLS_BILIKEY` 环境变量的部署实例，都使用此公开默认值
- 配合下面的 C4（弱加密实现），攻击者获取到配置文件后可轻易解密所有 B站凭证
- 结合 docker-compose-fullstack.yml 的硬编码默认值（见 C3），影响面更大

**修复**:

- 移除默认值，`BILILIVE_TOOLS_BILIKEY` 未设置时**拒绝启动**（或首次启动自动生成随机密钥并持久化）
- 至少使用 `crypto.randomBytes(32).toString('hex')` 在首次启动时生成
- 将生成的密钥存入配置文件而非依赖环境变量（环境变量也可能被日志泄露）

---

### C3. Docker Compose 中硬编码默认 passkey 和 bilikey

**文件**: `docker/docker-compose-fullstack.yml`

```yaml
environment:
  BILILIVE_TOOLS_BILIKEY: ${BILILIVE_TOOLS_BILIKEY:-REDACTED_DOCKER_SECRET}
  BILILIVE_TOOLS_PASSKEY: ${BILILIVE_TOOLS_PASSKEY:-REDACTED_DOCKER_SECRET}
```

**影响**:

- 如果用户直接使用此 compose 文件且未显式设置环境变量，passkey 和 bilikey 均为 `REDACTED_DOCKER_SECRET`
- passkey 是 HTTP API 的**唯一认证凭据**，知道 passkey 即可完全控制服务
- bilikey 用于加密存储的 B站 cookie，知道 bilikey 可解密所有用户凭证

**修复**:

- 移除硬编码默认值，改为 **必须由用户提供**（不提供则启动失败并给出明确提示）
- 或在首次启动时自动生成随机值并打印到日志，提示用户保存
- `docker/docker-compose.yml` 中的 `your_passkey` / `your_bilikey` 占位符是正确的做法，fullstack 版本应统一

---

## 🟠 HIGH — 3 项（应尽快修复）

### H1. 加密实现严重缺陷 — 零IV + 固定盐 + 无认证

**文件**: `packages/shared/src/utils/crypto.ts`

```typescript
const ALGORITHM = "aes-256-cbc";

export const encrypt = (data: string, password: string): string => {
  const key = crypto.scryptSync(password, "salt", 32); // ← 固定 salt
  const iv = Buffer.alloc(16, 0); // ← 全零 IV
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  // ...
};
```

**三个严重问题**:

| 问题           | 说明                                                     | 真实世界后果                                                                                 |
| -------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **全零 IV**    | `Buffer.alloc(16, 0)` 所有用户使用相同全零 IV            | CBC 模式退化为 ECB 模式。相同密码加密的相同明文块产生相同密文块。攻击者可识别重复数据模式    |
| **固定 salt**  | `scryptSync(password, "salt", 32)` 所有用户用同一个 salt | 丧失抗彩虹表能力。攻击者可预计算 "salt" + 常见密码的密钥表                                   |
| **无认证加密** | AES-CBC 无 HMAC/GCM                                      | 密文可被篡改而无法检测。存在 padding oracle 攻击面。攻击者可能通过修改密文来操纵解密后的数据 |

**影响链**:

1. 用户 B站 cookie/access_token 用此函数加密存于配置文件
2. 若攻击者获取到配置文件（如备份泄露、容器 volume 挂载权限问题）
3. 因全零 IV + 固定 salt，暴力破解或彩虹表攻击成本大幅降低
4. 即使不知道密钥，无认证的 CBC 模式也允许密文篡改

**修复**:

- 改为 AES-256-GCM（内置认证），或 AES-256-CBC + HMAC-SHA256（Encrypt-then-MAC）
- 每次加密生成随机 IV（`crypto.randomBytes(16)`），将 IV 前置在密文中
- 使用随机 salt（`crypto.randomBytes(16).toString('hex')`），与密文一起存储
- 考虑使用 `crypto.createCipher` 的更高层 API 或 libsodium/nacl

---

### H2. PassKey 生成使用非安全随机数

**文件**: `packages/shared/src/config.ts:105`

```typescript
APP_DEFAULT_CONFIG.passKey = Math.random().toString(36).slice(-16);
```

**影响**:

- `Math.random()` 在 V8 中使用 xorshift128+，**不是密码学安全的随机数生成器**
- 其内部状态可被预测，攻击者可能在观察到少量输出后预测后续 passKey
- passKey 是 HTTP API 的**唯一认证凭据**（Bearer token 模式），泄露 = 完全控制

**修复**:

```typescript
import crypto from "node:crypto";
APP_DEFAULT_CONFIG.passKey = crypto.randomBytes(32).toString("base64url");
```

---

### H3. 认证中间件无暴力破解防护

**文件**: `packages/http/src/index.ts:46-74`

```typescript
const authMiddleware = (passKey: string | number) => {
  return async (ctx, next) => {
    // ...
    if (token !== passKey) {
      // ← 非时间恒定比较 + 无频率限制
      ctx.status = 401;
      ctx.body = "Forbidden";
      return;
    }
    // ...
  };
};
```

**影响**:

- 没有速率限制，攻击者可以无限次尝试 passKey
- 使用 `!==` 而非时间恒定比较，理论上存在 timing attack 泄露 passKey 字符的可能性
- passKey 本身只有 ~59 位有效熵（见 H2），暴力枚举可行

**修复**:

- 添加速率限制中间件（如 `koa-ratelimit` 或基于 IP 的指数退避）
- 使用 `crypto.timingSafeEqual()` 进行时间恒定比较
- 连续失败 N 次后临时封禁 IP

---

## 🟡 MEDIUM — 2 项

### M1. `/api/user/get_cookie` 端点的双重保护均可绕过

**文件**: `packages/http/src/routes/user.ts:41-79`

当前保护措施：

1. **时间戳窗口** (10秒) — 可被 NTP 同步的攻击者轻松满足
2. **HMAC 签名** — 密钥已硬编码在仓库中（见 C1）

由于 C1，这个端点的安全完全依赖于 HTTP 服务仅监听 localhost。如果用户改了 `host` 配置为 `0.0.0.0`，此端点直接暴露完整 B站 cookie。

**修复**: 除修复 C1 外，考虑：

- 此端点强制仅允许 localhost 来源（检查 `ctx.ip` 或 `ctx.host`）
- 或添加 passKey 认证层（目前 user 路由在 auth 中间件之后注册，但需确认全局 auth 是否覆盖此路由）

---

### M2. 用户导出功能无额外鉴权

**文件**: `packages/http/src/routes/user.ts:81-95`

```typescript
router.get("/export", async (ctx) => {
  const list = biliService.readUserList();
  ctx.body = list; // ← 返回完整 BiliUser 数据，含 cookie/accessToken/refreshToken
});
```

只要有 passKey 就能一次性导出所有用户的完整凭证（含加密后的 cookie）。

**修复**:

- `/export` 端点应对敏感字段做脱敏处理（或至少确认这是预期行为并有文档说明风险）
- 当前加密存储提供了一层保护，但由于 H1 弱加密，这层保护不够可靠

---

## 🟢 GOOD — 已做对的事

- ✅ `.gitignore` 正确排除 `.env`、`*.db`、`cookies.json`、`.flow-active`、`test-results/`
- ✅ git 历史中无 `.env` 文件提交记录
- ✅ 无 SSH 私钥、SSL 证书、`.pem`/`.key`/`.p12` 文件泄露
- ✅ 无数据库连接字符串密码泄露（使用 SQLite 文件数据库）
- ✅ 无第三方服务 API key 硬编码（OpenAI/阿里云等 key 均为用户通过配置提供）
- ✅ autoClip 端点有速率限制（`packages/http/src/routes/autoClip.ts`）
- ✅ `docker/docker-compose.yml` 使用占位符 `your_passkey` 而非硬编码值

---

## 📊 风险矩阵

| #   | 问题                        | 等级        | 利用难度              | 影响范围               | 是否已泄露到 GitHub |
| --- | --------------------------- | ----------- | --------------------- | ---------------------- | ------------------- |
| C1  | HMAC 密钥硬编码             | 🔴 CRITICAL | 低（直接读源码）      | B站 cookie 窃取        | ✅ 是               |
| C2  | 默认加密密钥硬编码          | 🔴 CRITICAL | 低（直接读源码）      | 所有用户 B站凭证可解密 | ✅ 是               |
| C3  | 默认 passkey 硬编码         | 🔴 CRITICAL | 低（直接读源码）      | 完全控制 API           | ✅ 是               |
| H1  | 弱加密（零IV+固定盐）       | 🟠 HIGH     | 中（需配置文件访问）  | 存储凭证可被解密/篡改  | ✅ 是（代码）       |
| H2  | 非安全随机数生成            | 🟠 HIGH     | 中（需预测随机状态）  | passKey 可被预测       | ✅ 是（代码）       |
| H3  | 无暴力破解防护              | 🟠 HIGH     | 低                    | API 认证可被暴力破解   | ✅ 是（代码）       |
| M1  | get_cookie 双重保护形同虚设 | 🟡 MEDIUM   | 中                    | 结合 C1 可窃取 cookie  | N/A                 |
| M2  | 用户导出无额外鉴权          | 🟡 MEDIUM   | 低（有 passKey 即可） | 批量泄露用户凭证       | N/A                 |

---

## 🔧 修复优先级

### 立即（今天）：

1. **轮换 `user.ts` 中的 HMAC secret**（C1）— 改为环境变量，旧值作废
2. **移除 `docker-compose-fullstack.yml` 中的硬编码默认值**（C3）
3. **移除 `bili.ts` 中的 `DEFAULT_PASSKEY`**（C2）— 未设置 BILIKEY 时拒绝启动

### 本周内：

4. **重写 `crypto.ts`**（H1）— AES-256-GCM + 随机 IV + 随机 salt
5. **将 passKey 生成改为 `crypto.randomBytes()`**（H2）
6. **添加认证速率限制**（H3）

### 本月内：

7. **加固 `/api/user/get_cookie` 端点**（M1）— 限制来源 IP 或添加额外认证层
8. **审查 `/api/user/export` 端点**（M2）— 确认是否需要脱敏

---

> **注意**: 此报告仅针对已推送至 GitHub 的代码。实际部署环境的配置文件（含真实 passKey/bilikey/用户 cookie）不在仓库中，未纳入审计范围。但如果用户使用了 docker-compose 的默认值（C3）、未设置环境变量（C2）、或服务暴露在公网（H3），则面临实际风险。
