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

# 读取 .flow-active，返回 JSON。不存在则返回非零
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
