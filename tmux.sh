#!/usr/bin/env bash

set -euo pipefail

SESSION="${1:-emwaver}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! tmux has-session -t="$SESSION" 2>/dev/null; then
  tmux new-session -ds "$SESSION" -c "$PROJECT_DIR"
fi

FIRST_WINDOW_INDEX="$(tmux list-windows -t "$SESSION" -F '#{window_index}' | head -n1)"
FIRST_WINDOW_TARGET="$SESSION:$FIRST_WINDOW_INDEX"

# If layout already exists, skip re-creating panes/windows.
if tmux list-windows -t "$SESSION" -F '#{window_name}' | grep -qx 'dev'; then
  if [[ -z "${TMUX:-}" ]]; then
    tmux attach-session -t "$SESSION"
  else
    tmux switch-client -t "$SESSION"
  fi
  exit 0
fi

# Window 1: Dev (lazygit + backend + frontend) — 3 panes, all auto-run
# Force the first pane to the correct directory just in case
tmux send-keys -t "$FIRST_WINDOW_TARGET" 'cd ' "$PROJECT_DIR" C-m
tmux clear-history -t "$FIRST_WINDOW_TARGET"

tmux rename-window -t "$FIRST_WINDOW_TARGET" 'dev'

# Layout:
#   [ lazygit ] | [ backend ]
#              | [ frontend ]
PANE_GIT=$(tmux display-message -p -t "$FIRST_WINDOW_TARGET" '#{pane_id}')
# Make lazygit pane narrower (left), leave more space for backend/frontend
PANE_RIGHT=$(tmux split-window -h -l 50% -t "$PANE_GIT" -c "$PROJECT_DIR" -P -F '#{pane_id}')
PANE_FRONTEND=$(tmux split-window -v -l 50% -t "$PANE_RIGHT" -c "$PROJECT_DIR" -P -F '#{pane_id}')
PANE_BACKEND="$PANE_RIGHT"

# lazygit
tmux send-keys -t "$PANE_GIT" 'lazygit' C-m

# backend
tmux send-keys -t "$PANE_BACKEND" 'cd backend' C-m
tmux send-keys -t "$PANE_BACKEND" 'python app.py' C-m

# frontend
tmux send-keys -t "$PANE_FRONTEND" 'cd frontend' C-m
tmux send-keys -t "$PANE_FRONTEND" 'npm run dev' C-m

# Window 2: Dev Ops (2x2 Grid) — typed only
# Android | SecureWaver (tauri)
# emwaver.sh | emwaver daemon TUI

PANE_TOP_LEFT=$(tmux new-window -t "$SESSION" -n 'dev-ops' -c "$PROJECT_DIR" -P -F '#{pane_id}')
PANE_TOP_RIGHT=$(tmux split-window -h -l 50% -t "$PANE_TOP_LEFT" -c "$PROJECT_DIR" -P -F '#{pane_id}')
PANE_BOTTOM_LEFT=$(tmux split-window -v -l 50% -t "$PANE_TOP_LEFT" -c "$PROJECT_DIR" -P -F '#{pane_id}')
PANE_BOTTOM_RIGHT=$(tmux split-window -v -l 50% -t "$PANE_TOP_RIGHT" -c "$PROJECT_DIR" -P -F '#{pane_id}')

# Typed only (no enter)
tmux send-keys -t "$PANE_TOP_LEFT" 'cd android' C-m
tmux send-keys -t "$PANE_TOP_LEFT" './gradlew installDebug'

tmux send-keys -t "$PANE_TOP_RIGHT" 'cd securewaver' C-m
tmux send-keys -t "$PANE_TOP_RIGHT" 'npm run tauri'
tmux send-keys -t "$PANE_BOTTOM_LEFT" './emwaver.sh '
tmux send-keys -t "$PANE_BOTTOM_RIGHT" './emwaver.sh tui'

# Start on git window

tmux select-window -t "$SESSION:dev"
tmux select-pane -t "$PANE_GIT"

if [[ -z "${TMUX:-}" ]]; then
  tmux attach-session -t "$SESSION"
else
  tmux switch-client -t "$SESSION"
fi
