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

SESSION_NAME="firmware"

FIRMWARE_DIR="${REPO_ROOT}/main"

if tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
  echo "tmux session '${SESSION_NAME}' already exists; nothing to do."
  exit 0
fi

if [[ ! -d "${FIRMWARE_DIR}" ]]; then
  echo "Firmware directory not found at '${FIRMWARE_DIR}'" >&2
  exit 1
fi

tmux new-session -d -s "${SESSION_NAME}" -c "${REPO_ROOT}" -n "work"
tmux send-keys -t "${SESSION_NAME}:work.0" "cd '${REPO_ROOT}'" C-m

tmux split-window -h -t "${SESSION_NAME}:work" -c "${REPO_ROOT}"
tmux send-keys -t "${SESSION_NAME}:work.1" "cd '${REPO_ROOT}'" C-m

tmux new-window -t "${SESSION_NAME}" -n "firmware" -c "${REPO_ROOT}"
tmux send-keys -t "${SESSION_NAME}:firmware.0" "cd '${REPO_ROOT}'" C-m
tmux send-keys -t "${SESSION_NAME}:firmware.0" "source setup.sh" C-m
tmux send-keys -t "${SESSION_NAME}:firmware.0" "idf.py build" C-m

tmux split-window -v -t "${SESSION_NAME}:firmware" -c "${REPO_ROOT}"
tmux send-keys -t "${SESSION_NAME}:firmware.1" "cd '${REPO_ROOT}'" C-m

tmux select-window -t "${SESSION_NAME}:work"
tmux select-pane -t "${SESSION_NAME}:work.0"

echo "Created tmux session '${SESSION_NAME}'."
