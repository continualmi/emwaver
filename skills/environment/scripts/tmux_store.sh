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
SESSION_NAME="${WORKTREE_NAME}-store"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"
ensure_env_script

ENV_SCRIPT="$HOME/setup/emwaver-env.sh"
FRONTEND_DIR="${REPO_ROOT}/emwaver-frontend"

if tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
  echo "tmux session '${SESSION_NAME}' already exists; nothing to do."
  exit 0
fi

if [[ ! -d "${FRONTEND_DIR}" ]]; then
  echo "Store project directory not found at '${FRONTEND_DIR}'" >&2
  exit 1
fi

if [[ ! -f "${ENV_SCRIPT}" ]]; then
  echo "Warning: environment script '${ENV_SCRIPT}' not found; store panes will skip sourcing it" >&2
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

tmux new-window -t "${SESSION_NAME}" -n "store" -c "${FRONTEND_DIR}"
tmux send-keys -t "${SESSION_NAME}:store.0" "cd '${FRONTEND_DIR}'" C-m

if [[ -f "${ENV_SCRIPT}" ]]; then
  tmux send-keys -t "${SESSION_NAME}:store.0" "source '${ENV_SCRIPT}'" C-m
fi

tmux send-keys -t "${SESSION_NAME}:store.0" "npm install" C-m

tmux split-window -h -t "${SESSION_NAME}:store" -c "${FRONTEND_DIR}"
tmux send-keys -t "${SESSION_NAME}:store.1" "cd '${FRONTEND_DIR}'" C-m
if [[ -f "${ENV_SCRIPT}" ]]; then
  tmux send-keys -t "${SESSION_NAME}:store.1" "source '${ENV_SCRIPT}'" C-m
fi
tmux send-keys -t "${SESSION_NAME}:store.1" "npm run dev" C-m

tmux split-window -v -t "${SESSION_NAME}:store.1" -c "${FRONTEND_DIR}"
tmux send-keys -t "${SESSION_NAME}:store.2" "cd '${FRONTEND_DIR}'" C-m
tmux send-keys -t "${SESSION_NAME}:store.2" "${EDITOR:-vim}" C-m

tmux select-window -t "${SESSION_NAME}:work"
tmux select-pane -t "${SESSION_NAME}:work.0"

echo "Created tmux session '${SESSION_NAME}'."
