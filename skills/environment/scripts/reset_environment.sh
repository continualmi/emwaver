#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Kill all tmux sessions if tmux is available.
if command -v tmux >/dev/null 2>&1; then
  tmux list-sessions >/dev/null 2>&1 && tmux kill-server || true
fi

# Remove all linked worktrees except the main working tree.
while read -r path; do
  # Skip the primary worktree (the repo root itself).
  if [ "${path}" = "${REPO_ROOT}" ]; then
    continue
  fi

  if [ -d "${path}" ]; then
    git -C "${REPO_ROOT}" worktree remove --force "${path}" || true
  fi
done < <(git -C "${REPO_ROOT}" worktree list --porcelain | awk '/^worktree / {print $2}')

echo "All tmux sessions terminated and auxiliary worktrees removed."
