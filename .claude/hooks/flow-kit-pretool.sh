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

warn() {
  local msg="$1"
  echo "{\"hookSpecificOutput\": {\"hookEventName\": \"PreToolUse\", \"additionalContext\": \"[flow-kit gate] $msg\"}}"
}

# G1: phase < 4，只能写 .md 或 .flow-active
if [ "$PHASE" -lt 4 ] 2>/dev/null; then
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
