#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/flow-kit-lib.sh"

HOOK_INPUT=$(cat)

PROJECT_DIR=$(echo "$HOOK_INPUT" | get_project_dir)
STATE_FILE="$PROJECT_DIR/.flow-active"

# 无 .flow-active → 不是 flow 项目，静默退出
if [ ! -f "$STATE_FILE" ]; then
  exit 0
fi

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
