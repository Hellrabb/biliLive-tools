#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/flow-kit-lib.sh"

HOOK_INPUT=$(cat)

PROMPT=$(echo "$HOOK_INPUT" | jq -r '.prompt // ""')
PROJECT_DIR=$(echo "$HOOK_INPUT" | get_project_dir)
STATE_FILE="$PROJECT_DIR/.flow-active"

# /flow start — 创建 .flow-active
if echo "$PROMPT" | grep -qE '^/flow start'; then
  if [ -f "$STATE_FILE" ]; then
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

exit 0
