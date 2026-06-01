# flow-kit Hook 集成实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过 Claude Code hook 实现 flow-kit 工作流的自动阶段路由、运行时门禁和 session 恢复。

**Architecture:** 4 个 bash 脚本 + 1 个共享库，部署在项目级 `.claude/hooks/` 下。SessionStart hook 注入当前阶段 prompt，UserPromptSubmit hook 检测 `/flow` 命令管理 `.flow-active` 状态文件，PreToolUse hook 做阶段门禁。全部 fail-open，hook 挂了不阻断 Claude Code。

**Tech Stack:** bash, jq, Claude Code hooks (SessionStart / UserPromptSubmit / PreToolUse)

---

## 文件结构

```
.claude/hooks/
├── flow-kit-lib.sh          # 共享函数库
├── flow-kit-session.sh      # SessionStart: 注入 prompt
├── flow-kit-prompt.sh       # UserPromptSubmit: 命令检测
└── flow-kit-pretool.sh      # PreToolUse: 运行时门禁

.claude/settings.json        # 修改: 添加 3 个 hook 配置
.gitignore                   # 修改: 添加 .flow-active
```

**依赖:**
- `jq` — JSON 解析（已预装于大多数 Linux 发行版）
- `~/.claude/flow-kit/` — flow-kit 仓库（已存在）

---

### Task 1: 创建共享函数库 `flow-kit-lib.sh`

**Files:**
- Create: `.claude/hooks/flow-kit-lib.sh`

- [ ] **Step 1: 写入 flow-kit-lib.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

FLOW_KIT_DIR="$HOME/.claude/flow-kit"

# 从 stdin JSON 读取项目目录（优先 cwd 字段，其次 CLAUDE_PROJECT_DIR 环境变量）
get_project_dir() {
  local dir
  dir=$(jq -r '.cwd // ""' 2>/dev/null || true)
  if [ -z "$dir" ] || [ "$dir" = "null" ]; then
    dir="${CLAUDE_PROJECT_DIR:-}"
  fi
  if [ -z "$dir" ]; then
    dir=$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")
  fi
  echo "$dir"
}

# 读取 .flow-active，返回 JSON。不存在则返回空字符串
read_flow_state() {
  local project_dir="$1"
  local state_file="$project_dir/.flow-active"
  if [ ! -f "$state_file" ]; then
    return 1
  fi
  cat "$state_file"
}

# 根据 phase 返回 prompt 文件名
get_prompt_for_phase() {
  local phase="$1"
  case "$phase" in
    0) echo "prompts/0-change.md" ;;
    1) echo "prompts/1-requirement.md" ;;
    2) echo "prompts/2-design.md" ;;
    2a) echo "prompts/2a-ui-design.md" ;;
    3) echo "prompts/3-task.md" ;;
    4) echo "prompts/4-dev.md" ;;
    5) echo "prompts/5-test.md" ;;
    6) echo "prompts/6-review.md" ;;
    7) echo "prompts/7-integration.md" ;;
    *) return 1 ;;
  esac
}

# 获取 task 的 write_files 列表（从 TASK.md）
get_task_write_files() {
  local project_dir="$1"
  local change_id="$2"
  local task_id="$3"
  local task_file="$project_dir/.specs/$change_id/TASK.md"

  if [ ! -f "$task_file" ]; then
    echo ""
    return
  fi

  # 从 TASK.md 中提取当前 task 的 write_files 行
  # 格式: <write_files>path1, path2</write_files>
  awk -v tid="$task_id" '
    BEGIN { in_task=0; files="" }
    $0 ~ "<task.*id=\"" tid "\"" { in_task=1 }
    in_task && /<write_files>/ {
      gsub(/.*<write_files>/, "")
      gsub(/<\/write_files>.*/, "")
      gsub(/[[:space:]]+/, "")
      files=$0
      print files
      exit
    }
    in_task && /<\/task>/ { in_task=0 }
  ' "$task_file"
}
```

- [ ] **Step 2: 设置可执行权限**

```bash
chmod +x .claude/hooks/flow-kit-lib.sh
```

---

### Task 2: 创建 SessionStart hook `flow-kit-session.sh`

**Files:**
- Create: `.claude/hooks/flow-kit-session.sh`

- [ ] **Step 1: 写入 flow-kit-session.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/flow-kit-lib.sh"

# 从 stdin 读取 hook 输入，获取项目目录
HOOK_INPUT=$(cat)

PROJECT_DIR=$(echo "$HOOK_INPUT" | get_project_dir)
STATE_FILE="$PROJECT_DIR/.flow-active"

# 无 .flow-active → 不是 flow 项目，静默退出
if [ ! -f "$STATE_FILE" ]; then
  exit 0
fi

# 读取状态
STATE=$(cat "$STATE_FILE")
PHASE=$(echo "$STATE" | jq -r '.phase // 0')
CHANGE_ID=$(echo "$STATE" | jq -r '.change_id // ""')
TASK_ID=$(echo "$STATE" | jq -r '.task_id // ""')

# 注入 SYSTEM.md
if [ -f "$FLOW_KIT_DIR/SYSTEM.md" ]; then
  cat "$FLOW_KIT_DIR/SYSTEM.md"
fi

# 注入当前阶段 prompt
PROMPT_FILE=$(get_prompt_for_phase "$PHASE" 2>/dev/null || true)
if [ -n "$PROMPT_FILE" ] && [ -f "$FLOW_KIT_DIR/$PROMPT_FILE" ]; then
  echo ""
  echo "---"
  echo "## 当前 flow-kit 状态"
  echo ""
  echo "- change_id: ${CHANGE_ID:-未设定}"
  echo "- phase: $PHASE"
  [ -n "$TASK_ID" ] && [ "$TASK_ID" != "null" ] && echo "- task_id: $TASK_ID"
  echo ""
  cat "$FLOW_KIT_DIR/$PROMPT_FILE"
fi
```

- [ ] **Step 2: 设置可执行权限**

```bash
chmod +x .claude/hooks/flow-kit-session.sh
```

---

### Task 3: 创建 UserPromptSubmit hook `flow-kit-prompt.sh`

**Files:**
- Create: `.claude/hooks/flow-kit-prompt.sh`

- [ ] **Step 1: 写入 flow-kit-prompt.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/flow-kit-lib.sh"

HOOK_INPUT=$(cat)

# 读取用户 prompt 和项目目录
PROMPT=$(echo "$HOOK_INPUT" | jq -r '.prompt // ""')
PROJECT_DIR=$(echo "$HOOK_INPUT" | get_project_dir)
STATE_FILE="$PROJECT_DIR/.flow-active"

# /flow start — 创建 .flow-active
if echo "$PROMPT" | grep -qE '^/flow start'; then
  if [ -f "$STATE_FILE" ]; then
    # 已有活跃 flow，警告但不阻断
    OLD_CHANGE=$(jq -r '.change_id // ""' "$STATE_FILE")
    echo "{\"hookSpecificOutput\": {\"hookEventName\": \"UserPromptSubmit\", \"systemMessage\": \"已有活跃的 flow change '$OLD_CHANGE'。如需开始新 change，请先 /flow stop\"}}"
    exit 0
  fi
  cat > "$STATE_FILE" <<'STATE_JSON'
{"change_id": null, "phase": 0, "task_id": null}
STATE_JSON
  echo "{\"hookSpecificOutput\": {\"hookEventName\": \"UserPromptSubmit\", \"systemMessage\": \"flow-kit 已激活 (phase 0)。新 session 将自动加载 0-change prompt。\"}}"
  exit 0
fi

# /flow stop — 删除 .flow-active
if echo "$PROMPT" | grep -qE '^/flow stop'; then
  if [ -f "$STATE_FILE" ]; then
    CHANGE_ID=$(jq -r '.change_id // ""' "$STATE_FILE")
    rm -f "$STATE_FILE"
    echo "{\"hookSpecificOutput\": {\"hookEventName\": \"UserPromptSubmit\", \"systemMessage\": \"flow-kit 已停止${CHANGE_ID:+ (change: $CHANGE_ID)}。正常模式。\"}}"
  else
    echo "{\"hookSpecificOutput\": {\"hookEventName\": \"UserPromptSubmit\", \"systemMessage\": \"当前没有活跃的 flow。\"}}"
  fi
  exit 0
fi

# /flow phase <n> — 手动切换阶段
if echo "$PROMPT" | grep -qE '^/flow phase '; then
  if [ ! -f "$STATE_FILE" ]; then
    echo "{\"hookSpecificOutput\": {\"hookEventName\": \"UserPromptSubmit\", \"systemMessage\": \"没有活跃的 flow。请先 /flow start\"}}"
    exit 0
  fi
  NEW_PHASE=$(echo "$PROMPT" | sed 's/\/flow phase //' | xargs)
  if ! echo "$NEW_PHASE" | grep -qE '^[0-7]$|^2a$'; then
    echo "{\"hookSpecificOutput\": {\"hookEventName\": \"UserPromptSubmit\", \"systemMessage\": \"无效的阶段: $NEW_PHASE。有效值: 0, 1, 2, 2a, 3, 4, 5, 6, 7\"}}"
    exit 0
  fi
  OLD_PHASE=$(jq -r '.phase' "$STATE_FILE")
  jq --arg p "$NEW_PHASE" '.phase = $p' "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
  echo "{\"hookSpecificOutput\": {\"hookEventName\": \"UserPromptSubmit\", \"systemMessage\": \"阶段已切换: $OLD_PHASE → $NEW_PHASE。下次 session 将加载对应 prompt。\"}}"
  exit 0
fi

# 非 flow 命令，不做任何事
exit 0
```

- [ ] **Step 2: 设置可执行权限**

```bash
chmod +x .claude/hooks/flow-kit-prompt.sh
```

---

### Task 4: 创建 PreToolUse hook `flow-kit-pretool.sh`

**Files:**
- Create: `.claude/hooks/flow-kit-pretool.sh`

- [ ] **Step 1: 写入 flow-kit-pretool.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/flow-kit-lib.sh"

HOOK_INPUT=$(cat)

PROJECT_DIR=$(echo "$HOOK_INPUT" | get_project_dir)
STATE_FILE="$PROJECT_DIR/.flow-active"

# 无 .flow-active → 不是 flow 项目，不检查
if [ ! -f "$STATE_FILE" ]; then
  exit 0
fi

STATE=$(cat "$STATE_FILE")
PHASE=$(echo "$STATE" | jq -r '.phase // 0')
CHANGE_ID=$(echo "$STATE" | jq -r '.change_id // ""')
TASK_ID=$(echo "$STATE" | jq -r '.task_id // ""')
TOOL_NAME=$(echo "$HOOK_INPUT" | jq -r '.tool_name // ""')
FILE_PATH=$(echo "$HOOK_INPUT" | jq -r '.tool_input.file_path // ""')

# 没有文件路径 → 不检查
[ -z "$FILE_PATH" ] && exit 0

# 转换为相对于项目根目录的路径（如果是绝对路径）
RELATIVE_PATH="${FILE_PATH#$PROJECT_DIR/}"

# 生成 warning_message 并输出为 additionalContext
warn() {
  local msg="$1"
  echo "{\"hookSpecificOutput\": {\"hookEventName\": \"PreToolUse\", \"additionalContext\": \"[flow-kit gate] $msg\"}}"
}

# G1: phase < 4，只能写 .md 或 .flow-active
if [ "$PHASE" -lt 4 ] 2>/dev/null; then
  # 允许 .flow-active 自身，以及 spec 目录下的 .md 文件
  if ! echo "$FILE_PATH" | grep -qE '\.md$'; then
    if ! echo "$FILE_PATH" | grep -qE '\.flow-active$'; then
      warn "阶段 $PHASE 禁止写非 .md 文件: $FILE_PATH。阶段 0-3 只产出 markdown 工件。用 /flow phase 4 解锁代码写入。"
      exit 0
    fi
  fi
fi

# G2: phase = 4，有 task_id，检查写入文件是否在 task 声明的 write_files 中
if [ "$PHASE" = "4" ] && [ -n "$TASK_ID" ] && [ "$TASK_ID" != "null" ]; then
  WRITE_FILES=$(get_task_write_files "$PROJECT_DIR" "$CHANGE_ID" "$TASK_ID")
  if [ -n "$WRITE_FILES" ]; then
    MATCHED=false
    IFS=',' read -ra FILES <<< "$WRITE_FILES"
    for f in "${FILES[@]}"; do
      f=$(echo "$f" | xargs)
      if echo "$FILE_PATH" | grep -qF "$f"; then
        MATCHED=true
        break
      fi
    done
    if [ "$MATCHED" = false ]; then
      warn "当前 task '$TASK_ID' 的 write_files 不包含: $FILE_PATH。允许写入: $WRITE_FILES。如需加新文件，先更新 TASK.md。"
    fi
  fi
fi

# G3: phase = 4，task_id 为空
if [ "$PHASE" = "4" ] && { [ -z "$TASK_ID" ] || [ "$TASK_ID" = "null" ]; }; then
  warn "阶段 4 需要 task_id。请先完成阶段 3 任务拆解，或手动设置 /flow phase 4 前更新 task_id。"
fi

exit 0
```

- [ ] **Step 2: 设置可执行权限**

```bash
chmod +x .claude/hooks/flow-kit-pretool.sh
```

---

### Task 5: 配置 project settings.json 的 hooks

**Files:**
- Modify: `.claude/settings.json`

- [ ] **Step 1: 在现有 hooks 对象中添加 3 个 hook 配置**

现有 `.claude/settings.json`:
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{
          "type": "command",
          "command": "npx prettier --write \"${CLAUDE_TOOL_INPUT_FILE_PATH}\" 2>/dev/null || true"
        }]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "condition": "filePath.includes('.env') && !filePath.includes('.env.example')",
        "hooks": [{
          "type": "command",
          "command": "echo '[BLOCKED] Editing .env files is disabled to protect credentials' && exit 1"
        }]
      }
    ]
  },
  "permissions": { ... }
}
```

修改为:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [{
          "type": "command",
          "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/flow-kit-session.sh"
        }]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [{
          "type": "command",
          "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/flow-kit-prompt.sh"
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{
          "type": "command",
          "command": "npx prettier --write \"${CLAUDE_TOOL_INPUT_FILE_PATH}\" 2>/dev/null || true"
        }]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "condition": "filePath.includes('.env') && !filePath.includes('.env.example')",
        "hooks": [{
          "type": "command",
          "command": "echo '[BLOCKED] Editing .env files is disabled to protect credentials' && exit 1"
        }]
      },
      {
        "matcher": "Edit|Write",
        "hooks": [{
          "type": "command",
          "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/flow-kit-pretool.sh"
        }]
      }
    ]
  },
  "permissions": {
    "allow": [
      "Bash(npm:*)",
      "Bash(pnpm:*)",
      "Bash(git:*)",
      "Bash(docker:*)",
      "Bash(npx:*)"
    ]
  }
}
```

> **注意:** SessionStart 和 UserPromptSubmit 是新增的顶层 key。PreToolUse 在现有的 `env-block` matcher 之后追加一个新 block。其余 hook 配置不变。

- [ ] **Step 2: 验证 JSON 格式合法**

```bash
jq empty .claude/settings.json
```
Expected: 无输出（exit 0）

---

### Task 6: 添加 .flow-active 到 .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: 追加 .flow-active**

```bash
echo ".flow-active" >> .gitignore
```

- [ ] **Step 2: 提交**

```bash
git add .gitignore
git commit -m "chore: add .flow-active to gitignore"
```

---

### Task 7: 手动验证

- [ ] **Step 1: 验证 /flow start**

在新 session 中输入:
```
/flow start
```
Expected: 看到 `flow-kit 已激活 (phase 0)` 提示

检查:
```bash
cat .flow-active
```
Expected: `{"change_id": null, "phase": 0, "task_id": null}`

- [ ] **Step 2: 验证 SessionStart prompt 注入**

`/clear` 或开新 session。

Expected: session 开始时看到 SYSTEM.md 内容 + 0-change prompt

- [ ] **Step 3: 验证 PreToolUse G1 门禁**

在 phase 0 时尝试写 `.ts` 文件:
```
请创建一个 src/test.ts 文件
```
Expected: AI 看到 `[flow-kit gate] 阶段 0 禁止写非 .md 文件` 警告

- [ ] **Step 4: 验证正常写 .md 不受阻**

```
请创建 .specs/test/CHANGE.md
```
Expected: 无门禁警告（.md 文件在 phase < 4 允许写入）

- [ ] **Step 5: 验证 /flow stop**

```
/flow stop
```
Expected: 看到停止提示，`.flow-active` 被删除

- [ ] **Step 6: 验证其他 skill 不受影响**

在非 flow 状态下调用任意 skill（如 brainstorming）:
```
/brainstorming 测试一下
```
Expected: skill 正常触发，无 flow-kit 干扰

---

### Task 8: 提交所有 hook 脚本

- [ ] **Step 1: 提交**

```bash
git add .claude/hooks/flow-kit-lib.sh \
        .claude/hooks/flow-kit-session.sh \
        .claude/hooks/flow-kit-prompt.sh \
        .claude/hooks/flow-kit-pretool.sh \
        .claude/settings.json
git commit -m "feat: add flow-kit hook integration

- SessionStart: auto-inject current phase prompt
- UserPromptSubmit: /flow start/stop/phase commands
- PreToolUse: phase gates (G1-G3)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```
