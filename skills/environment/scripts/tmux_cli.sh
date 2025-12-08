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

WORKTREE_NAME="$(basename "${REPO_ROOT}")"
SESSION_NAME="${WORKTREE_NAME}-cli"

CLI_DIR="${REPO_ROOT}/cli"

if tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
  echo "tmux session '${SESSION_NAME}' already exists; nothing to do."
  exit 0
fi

if [[ ! -d "${CLI_DIR}" ]]; then
  echo "CLI directory not found at '${CLI_DIR}'" >&2
  exit 1
fi

tmux new-session -d -s "${SESSION_NAME}" -c "${CLI_DIR}" -n "work"
tmux send-keys -t "${SESSION_NAME}:work.0" "cd '${CLI_DIR}'" C-m

tmux split-window -h -t "${SESSION_NAME}:work" -c "${CLI_DIR}"
tmux send-keys -t "${SESSION_NAME}:work.1" "cd '${CLI_DIR}'" C-m

tmux new-window -t "${SESSION_NAME}" -n "build" -c "${CLI_DIR}"
tmux send-keys -t "${SESSION_NAME}:build.0" "cd '${CLI_DIR}'" C-m
tmux send-keys -t "${SESSION_NAME}:build.0" "cargo build" C-m

tmux split-window -v -t "${SESSION_NAME}:build" -c "${CLI_DIR}"
tmux send-keys -t "${SESSION_NAME}:build.1" "cd '${CLI_DIR}'" C-m
tmux send-keys -t "${SESSION_NAME}:build.1" "cargo run" 


tmux select-window -t "${SESSION_NAME}:work"
tmux select-pane -t "${SESSION_NAME}:work.0"

echo "Created tmux session '${SESSION_NAME}'."
