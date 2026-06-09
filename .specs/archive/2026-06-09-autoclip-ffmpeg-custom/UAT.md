# UAT: AutoClip FFmpeg 预设参数预览

- **Change ID**: autoclip-ffmpeg-custom
- **关联**: `@.specs/autoclip-ffmpeg-custom/TEST.md`

---

| UAT                               | AC   | 结果      | 备注                 |
| --------------------------------- | ---- | --------- | -------------------- |
| UAT-1 · 自定义预设出现在下拉中    | AC-1 | 🟡 待人工 | 需在 Electron 中运行 |
| UAT-2 · 下拉展示内置 + 自定义预设 | AC-2 | 🟡 待人工 |                      |
| UAT-3 · 选中预设后参数预览        | AC-3 | 🟡 待人工 |                      |
| UAT-4 · encoder 自动同步          | AC-4 | 🟡 待人工 |                      |
| UAT-5 · 跳转链接                  | AC-5 | 🟡 待人工 |                      |
| UAT-6 · 加载失败通知              | AC-6 | 🟡 待人工 |                      |

**自动化验证**：

- `typecheck:node` ✅
- `typecheck:web` ✅
- `build:webui` ⚠️ 已有 vue 编译错误（line 342 `{{ "{{" }}` 转义——与本次改动无关，`git stash` 后同样报错）

**UAT 执行指令**：

```bash
pnpm run dev    # 启动 Electron 开发环境
# 然后按 TEST.md 的 UAT-1 ~ UAT-6 步骤操作
```
