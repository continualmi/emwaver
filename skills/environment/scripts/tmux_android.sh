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

SESSION_NAME="android"

ANDROID_DIR="${REPO_ROOT}/android"

if tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
  echo "tmux session '${SESSION_NAME}' already exists; nothing to do."
  exit 0
fi

if [[ ! -d "${ANDROID_DIR}" ]]; then
  echo "Android directory not found at '${ANDROID_DIR}'" >&2
  exit 1
fi

tmux new-session -d -s "${SESSION_NAME}" -c "${REPO_ROOT}" -n "work"
tmux send-keys -t "${SESSION_NAME}:work.0" "cd '${REPO_ROOT}'" C-m

tmux split-window -h -t "${SESSION_NAME}:work" -c "${REPO_ROOT}"
tmux send-keys -t "${SESSION_NAME}:work.1" "cd '${REPO_ROOT}'" C-m
tmux send-keys -t "${SESSION_NAME}:work.1" "git status"

tmux new-window -t "${SESSION_NAME}" -n "dev" -c "${ANDROID_DIR}"
tmux send-keys -t "${SESSION_NAME}:dev.0" "cd '${ANDROID_DIR}'" C-m
tmux send-keys -t "${SESSION_NAME}:dev.0" "./gradlew installDebug"

tmux split-window -h -t "${SESSION_NAME}:dev" -c "${ANDROID_DIR}"
tmux send-keys -t "${SESSION_NAME}:dev.1" "cd '${ANDROID_DIR}'" C-m
tmux send-keys -t "${SESSION_NAME}:dev.1" "adb logcat"

tmux select-window -t "${SESSION_NAME}:work"
tmux select-pane -t "${SESSION_NAME}:work.0"

echo "Created tmux session '${SESSION_NAME}'."
