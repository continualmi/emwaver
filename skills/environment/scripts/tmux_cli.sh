#!/usr/bin/env bash
set -euo pipefail

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is not installed or not on PATH" >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${REPO_ROOT}" ]]; then
  echo "This script must be run inside a Git worktree" >&2
  exit 1
fi

TEMP_FILE="${REPO_ROOT}/temp.txt"
if [[ ! -f "${TEMP_FILE}" ]]; then
  cat <<'EOF' > "${TEMP_FILE}"
# Temporary instructions for this worktree.
# Replace this note with tasks for the current session.
EOF
fi

WORKTREE_NAME="$(basename "${REPO_ROOT}")"
SESSION_NAME="${WORKTREE_NAME}-cli"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"
ensure_env_script

ENV_SCRIPT="$HOME/setup/emwaver-env.sh"
CLI_DIR="${REPO_ROOT}/emwaver-cli"

if tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
  echo "tmux session '${SESSION_NAME}' already exists; nothing to do."
  exit 0
fi

if [[ ! -d "${CLI_DIR}" ]]; then
  echo "CLI project directory not found at '${CLI_DIR}'" >&2
  exit 1
fi

tmux new-session -d -s "${SESSION_NAME}" -c "${REPO_ROOT}" -n "work"
tmux send-keys -t "${SESSION_NAME}:work.0" "cd '${REPO_ROOT}'" C-m
tmux send-keys -t "${SESSION_NAME}:work.0" "droid" C-m

tmux split-window -h -t "${SESSION_NAME}:work" -c "${REPO_ROOT}"
tmux send-keys -t "${SESSION_NAME}:work.1" "cd '${REPO_ROOT}'" C-m
tmux send-keys -t "${SESSION_NAME}:work.1" "git status" C-m

tmux split-window -v -t "${SESSION_NAME}:work.1" -c "${REPO_ROOT}"
tmux send-keys -t "${SESSION_NAME}:work.2" "cd '${REPO_ROOT}'" C-m
tmux send-keys -t "${SESSION_NAME}:work.2" "${EDITOR:-vim}" C-m

tmux new-window -t "${SESSION_NAME}" -n "cli" -c "${CLI_DIR}"
tmux send-keys -t "${SESSION_NAME}:cli.0" "cd '${CLI_DIR}'" C-m
tmux send-keys -t "${SESSION_NAME}:cli.0" "cargo check" C-m

tmux split-window -h -t "${SESSION_NAME}:cli" -c "${CLI_DIR}"
tmux send-keys -t "${SESSION_NAME}:cli.1" "cd '${CLI_DIR}'" C-m
tmux send-keys -t "${SESSION_NAME}:cli.1" "cargo test" C-m

tmux split-window -v -t "${SESSION_NAME}:cli.1" -c "${CLI_DIR}"
tmux send-keys -t "${SESSION_NAME}:cli.2" "cd '${CLI_DIR}'" C-m
tmux send-keys -t "${SESSION_NAME}:cli.2" "${EDITOR:-vim}" C-m

tmux select-window -t "${SESSION_NAME}:work"
tmux select-pane -t "${SESSION_NAME}:work.0"

echo "Created tmux session '${SESSION_NAME}'."
