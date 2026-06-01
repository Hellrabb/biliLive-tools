# flow-kit Hook 集成设计

## 目标

通过 Claude Code hook 机制将 flow-kit 工作流自动化，实现：
- **自动阶段路由**：AI 自动识别当前阶段并加载对应 prompt
- **运行时门禁**：PreToolUse 强制检查，防止跳阶段写代码
- **Session 恢复**：新 session 自动恢复上次中断的 change/task

## 核心设计原则

1. **显式开关**：`/flow start` 激活，`/flow stop` 关闭，不干扰其他 skill
2. **Fail-open**：hook 挂了永远不影响 Claude Code 正常工作
3. **纯 bash**：不依赖 npm 包，仅需 `jq`

## 状态文件

### `.flow-active`

项目根目录，JSON 格式：

```json
{
  "change_id": null,
  "phase": 0,
  "task_id": null
}
```

- `change_id`: 对应 `.specs/<id>/` 目录。AI 在阶段 0 自动生成
- `phase`: 当前阶段号 (0-7)。AI 完成阶段后自动 +1
- `task_id`: 当前执行的 task（仅在阶段 4 有值）

`.flow-active` 加入 `.gitignore`。

### 阶段路由表

| phase | 注入 Prompt | 允许操作 |
|---|---|---|
| 0 | 0-change.md | 仅写 .md |
| 1 | 1-requirement.md | 仅写 .md |
| 2 | 2-design.md | 仅写 .md |
| 2a | 2a-ui-design.md | 仅写 .md |
| 3 | 3-task.md | 仅写 .md |
| 4 | 4-dev.md | 按 TASK.md 的 write_files 写 |
| 5 | 5-test.md | 无限制 |
| 6 | 6-review.md | 无限制 |
| 7 | 7-integration.md | 无限制 |

## 命令集

| 命令 | 作用 |
|---|---|
| `/flow start` | 创建 `.flow-active`，开始 flow 流程 |
| `/flow stop` | 删除 `.flow-active`，恢复正常模式 |
| `/flow phase <n>` | 手动切换阶段（备用） |

## Hook 架构

### 文件结构

```
.claude/hooks/
├── flow-kit-lib.sh          # 共享函数
├── flow-kit-session.sh      # SessionStart
├── flow-kit-prompt.sh       # UserPromptSubmit
└── flow-kit-pretool.sh      # PreToolUse
```

### SessionStart — 上下文注入

```
1. 检测 .flow-active → 不存在则跳过
2. 读取 phase
3. stdout 输出 SYSTEM.md + 当前阶段 prompt
4. Claude Code 将 stdout 注入为上下文
```

### UserPromptSubmit — 命令检测

```
- "/flow start"     → 创建 .flow-active, phase=0
- "/flow stop"      → 删除 .flow-active
- "/flow phase <n>" → 更新 phase 字段
- 其他              → 透传
```

### PreToolUse — 运行时门禁

| 规则 | 触发条件 | 输出 |
|---|---|---|
| G1 | phase < 4 且目标文件非 .md | "阶段 {phase} 禁止写非 .md 文件" |
| G2 | phase=4 且有 task_id，写入文件不在当前 task 的 write_files 列表 | "当前 task 不允许写 {file}" |
| G3 | phase=4 且 task_id 为空 | "阶段 4 需要 task_id" |
| G4 | phase=7 尝试新 /flow start | "当前 change 尚未归档" |

门禁向 stderr 输出警告，不阻断工具调用。门禁依据从项目文件读取：
- G2 依据：`.specs/<change_id>/TASK.md` 的 `write_files`
- G3/G4 依据：`.flow-active` 的 `task_id` / `phase`

## 边界处理

| 场景 | 行为 |
|---|---|
| `.flow-active` 不存在 | 零开销，不影响正常使用 |
| `.flow-active` JSON 损坏 | exit 0，静默跳过 |
| flow-kit 目录不存在 | SessionStart 跳过注入 |
| PreToolUse hook 挂了 | 显示警告但允许继续 |
| 阶段 4 中退出后重开 session | 读 phase=4 + task_id，注入 4-dev prompt |
| 非 flow 项目 `/flow start` | 正常开始 |
| `jq` 未安装 | 提示安装，静默跳过 |

## settings.json 配置

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [{
          "type": "command",
          "command": "bash ${CLAUDE_PROJECT_DIR}/.claude/hooks/flow-kit-session.sh"
        }]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [{
          "type": "command",
          "command": "bash ${CLAUDE_PROJECT_DIR}/.claude/hooks/flow-kit-prompt.sh"
        }]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{
          "type": "command",
          "command": "bash ${CLAUDE_PROJECT_DIR}/.claude/hooks/flow-kit-pretool.sh"
        }]
      }
    ]
  }
}
```

## 与现有 skill 的兼容性

flow-kit 通过 `.flow-active` 状态文件激活，仅在 `/flow start` 后生效。其他 skill（brainstorming、TDD、code-review 等）在 flow 模式外完全不受影响。即使在 flow 模式内，UserPromptSubmit hook 只匹配 `/flow` 命令，不拦截其他 prompt 或 skill 调用。
