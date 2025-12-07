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
SESSION_NAME="${WORKTREE_NAME}-session"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"
ensure_env_script

ENV_SCRIPT="$HOME/setup/emwaver-env.sh"
ANDROID_DIR="${REPO_ROOT}/emwaver-android"
BACKEND_DIR="${REPO_ROOT}/emwaver-backend"
ADB_BIN="$HOME/Library/Android/sdk/platform-tools/adb"
PACKAGE_NAME="com.emwaver.emwaverandroidapp"

if tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
  echo "tmux session '${SESSION_NAME}' already exists; nothing to do."
  exit 0
fi

if [[ ! -d "${ANDROID_DIR}" ]]; then
  echo "Android project directory not found at '${ANDROID_DIR}'" >&2
  exit 1
fi

if [[ ! -d "${BACKEND_DIR}" ]]; then
  echo "Warning: backend directory '${BACKEND_DIR}' not found; pane commands may fail" >&2
fi

if [[ ! -f "${ENV_SCRIPT}" ]]; then
  echo "Warning: environment script '${ENV_SCRIPT}' not found; panes will skip sourcing it" >&2
fi

tmux new-session -d -s "${SESSION_NAME}" -c "${REPO_ROOT}" -n "work"
tmux send-keys -t "${SESSION_NAME}:work.0" "cd '${REPO_ROOT}'" C-m
tmux send-keys -t "${SESSION_NAME}:work.0" "droid" C-m
tmux send-keys -t "${SESSION_NAME}:work.0" "git status" C-m
tmux send-keys -t "${SESSION_NAME}:work.0" "${EDITOR:-vim}" C-m

tmux split-window -h -t "${SESSION_NAME}:work" -c "${REPO_ROOT}"
tmux split-window -v -t "${SESSION_NAME}:work.1" -c "${REPO_ROOT}"

tmux new-window -t "${SESSION_NAME}" -n "android" -c "${ANDROID_DIR}"

if [[ -x "${ADB_BIN}" ]]; then
  tmux send-keys -t "${SESSION_NAME}:android.0" "${ADB_BIN} logcat --pid=\$(${ADB_BIN} shell pidof -s ${PACKAGE_NAME}) -T 0"
else
  tmux send-keys -t "${SESSION_NAME}:android.0" "echo 'adb binary not found at ${ADB_BIN}'"
fi

tmux split-window -h -t "${SESSION_NAME}:android" -c "${ANDROID_DIR}"
if [[ -f "${ENV_SCRIPT}" ]]; then
  tmux send-keys -t "${SESSION_NAME}:android.1" "source '${ENV_SCRIPT}' && ./gradlew installDebug"
else
  tmux send-keys -t "${SESSION_NAME}:android.1" "./gradlew installDebug"
fi

BACKEND_PANE_DIR="${REPO_ROOT}"
if [[ -d "${BACKEND_DIR}" ]]; then
  BACKEND_PANE_DIR="${BACKEND_DIR}"
fi

tmux split-window -v -t "${SESSION_NAME}:android.1" -c "${BACKEND_PANE_DIR}"

if [[ -f "${ENV_SCRIPT}" ]]; then
  tmux send-keys -t "${SESSION_NAME}:android.2" "source '${ENV_SCRIPT}' && python3 app.py"
else
  tmux send-keys -t "${SESSION_NAME}:android.2" "python3 app.py"
fi

tmux select-window -t "${SESSION_NAME}:work"
tmux select-pane -t "${SESSION_NAME}:work.0"

echo "Created tmux session '${SESSION_NAME}'."
