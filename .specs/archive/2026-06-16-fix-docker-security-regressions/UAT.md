# UAT — fix-docker-security-regressions

> 日期：2026-06-16

## 自动化验证

| 命令                                           | 结果                                         |
| ---------------------------------------------- | -------------------------------------------- |
| `pnpm run build:base`                          | ✅ 全部包构建 + 测试通过                     |
| `pnpm run --filter biliLive-tools build:webui` | ✅ typecheck + electron-vite build           |
| `pnpm run test`（全量）                        | ✅ 53 files, 951 passed, 0 failed, 0 skipped |

## 人工 UAT

### UAT-1: Docker 构建

**步骤**:

1. `cd docker && docker compose -f docker-compose-fullstack.yml build`
2. 确认构建完成无错误

**预期**: 构建成功，不再出现 `build:webui exit code: 2`

- [ ] 通过

### UAT-2: 密钥来源日志

**步骤**:

1. 启动容器后查看日志：`docker logs bililive-tools-test`
2. 确认输出包含密钥来源信息

**预期**: 若 `.env` 配置了密钥，日志显示"使用环境变量 BILILIVE_TOOLS_PASSKEY 作为登录密钥"

- [ ] 通过

### UAT-3: verifyBiliKey 无需环境变量

**步骤**:

1. 访问 WebUI
2. 进入用户管理页面，尝试获取 B站 cookie
3. 在弹出的安全校验对话框中输入正确的 biliKey（来自 `.env` 中的 `BILILIVE_TOOLS_BILIKEY`）

**预期**: 验证通过，不再显示"未配置 BILILIVE_TOOLS_BILIKEY"

- [ ] 通过

### UAT-4: 旧数据兼容（仅升级用户）

**步骤**:

1. 使用升级前已存在的 B站账号数据
2. 进入用户管理页面查看账号列表

**预期**: 旧账号正常显示，数据自动迁移到新密钥

- [ ] 通过 / 不适用（全新部署）

### UAT-5: `.env` 不泄露

**步骤**:

1. `git status` 确认 `docker/.env` 不显示为待提交文件

**预期**: `.env` 被 gitignore 排除

- [ ] 通过
