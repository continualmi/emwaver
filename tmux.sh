#!/usr/bin/env bash

set -euo pipefail

SESSION="${1:-emwaver}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

window_exists() {
  local window_name="$1"
  tmux list-windows -t "$SESSION" -F '#{window_name}' | grep -qx "$window_name"
}

attach_or_switch() {
  if [[ -z "${TMUX:-}" ]]; then
    tmux attach-session -t "$SESSION"
  else
    tmux switch-client -t "$SESSION"
  fi
}

if ! tmux has-session -t="$SESSION" 2>/dev/null; then
  tmux new-session -ds "$SESSION" -c "$PROJECT_DIR"
fi

FIRST_WINDOW_INDEX="$(tmux list-windows -t "$SESSION" -F '#{window_index}' | head -n1)"
FIRST_WINDOW_TARGET="$SESSION:$FIRST_WINDOW_INDEX"

# If layout already exists, skip re-creating panes/windows.
if window_exists 'dev' && window_exists 'dev-ops'; then
  attach_or_switch
  exit 0
fi

# Window 1: Dev (backend + frontend) — 2 panes, all terminal-only
if window_exists 'dev'; then
  PANE_BACKEND=$(tmux display-message -p -t "$SESSION:dev" '#{pane_id}')
else
  # Force the first pane to the correct directory just in case
  tmux send-keys -t "$FIRST_WINDOW_TARGET" 'cd ' "$PROJECT_DIR" C-m
  tmux clear-history -t "$FIRST_WINDOW_TARGET"

  tmux rename-window -t "$FIRST_WINDOW_TARGET" 'dev'

  # Layout:
  #   [ backend ] | [ frontend ]
  PANE_BACKEND=$(tmux display-message -p -t "$FIRST_WINDOW_TARGET" '#{pane_id}')
  PANE_FRONTEND=$(tmux split-window -h -t "$PANE_BACKEND" -c "$PROJECT_DIR" -P -F '#{pane_id}')

  # backend
  tmux send-keys -t "$PANE_BACKEND" 'cd backend' C-m
  tmux send-keys -t "$PANE_BACKEND" 'python app.py' C-m

  # frontend
  tmux send-keys -t "$PANE_FRONTEND" 'cd frontend' C-m
  tmux send-keys -t "$PANE_FRONTEND" 'npm run dev' C-m
fi

# Window 2: Dev Ops (2x2 Grid) — typed only
# Android | SecureWaver (tauri)
# emwaver.sh | emwaver daemon TUI
if window_exists 'dev-ops'; then
  PANE_TOP_LEFT=$(tmux display-message -p -t "$SESSION:dev-ops" '#{pane_id}')
else
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
fi

# Start on dev window

tmux select-window -t "$SESSION:dev"
tmux select-pane -t "$PANE_BACKEND"

attach_or_switch
