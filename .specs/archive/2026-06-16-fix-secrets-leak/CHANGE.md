# CHANGE — fix-secrets-leak

> 创建日期：2026-06-16
> 来源：安全审计报告 `.specs/security-audit-2026-06-15.md`

## 动机

安全审计发现 6 项高中危问题，其中 3 个密钥/凭证已硬编码在公开 GitHub 仓库中。

## 范围

### v1（本次必须修）

- C1: 移除 `user.ts` 硬编码 HMAC secret → 首次启动自动生成，持久化到配置文件
- C2: 移除 `bili.ts` 默认加密密钥 → 首次启动自动生成
- C3: 移除 `docker-compose-fullstack.yml` 硬编码默认值 → 改为必填/自动生成
- H1: 重写 `crypto.ts` → AES-256-GCM + 随机 IV + 随机 salt
- H2: passKey 生成改用 `crypto.randomBytes()`
- 向后兼容：能读取旧格式加密数据（用旧方式解密，用新方式重新加密）

### v2（后续）

- H3: 认证暴力破解防护（速率限制）
- M1: `/api/user/get_cookie` 限制 localhost 来源
- M2: 导出端点脱敏

### out（不做）

- 不改变配置文件路径和格式（保持 electron-store 兼容）

## 便捷性原则

- 首次启动自动生成密钥，无需用户手动配置
- Docker 部署通过环境变量覆盖自动生成的密钥
- 旧数据自动迁移（旧加密→新加密），无需用户操作
