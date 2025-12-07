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
SESSION_NAME="${WORKTREE_NAME}-docs"

DOCS_DIR="${REPO_ROOT}/docs"

if tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
  echo "tmux session '${SESSION_NAME}' already exists; nothing to do."
  exit 0
fi

if [[ ! -d "${DOCS_DIR}" ]]; then
  echo "Docs directory not found at '${DOCS_DIR}'" >&2
  exit 1
fi

tmux new-session -d -s "${SESSION_NAME}" -c "${DOCS_DIR}" -n "work"
tmux send-keys -t "${SESSION_NAME}:work.0" "cd '${DOCS_DIR}'" C-m

tmux split-window -h -t "${SESSION_NAME}:work" -c "${DOCS_DIR}"
tmux send-keys -t "${SESSION_NAME}:work.1" "cd '${DOCS_DIR}'" C-m

tmux new-window -t "${SESSION_NAME}" -n "serve" -c "${DOCS_DIR}"
tmux send-keys -t "${SESSION_NAME}:serve.0" "cd '${DOCS_DIR}'" C-m
tmux send-keys -t "${SESSION_NAME}:serve.0" "mkdocs serve" C-m

tmux split-window -v -t "${SESSION_NAME}:serve" -c "${DOCS_DIR}"
tmux send-keys -t "${SESSION_NAME}:serve.1" "cd '${DOCS_DIR}'" C-m

tmux select-window -t "${SESSION_NAME}:work"
tmux select-pane -t "${SESSION_NAME}:work.0"

echo "Created tmux session '${SESSION_NAME}'."
