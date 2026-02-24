#!/usr/bin/env bash

set -euo pipefail

SESSION="${1:-emwaver}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKOUTS_DIR="$PROJECT_DIR/.dev-checkouts"

checkout_path() {
  local n="$1"
  printf '%s/emwaver-%s' "$CHECKOUTS_DIR" "$n"
}

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

ensure_dev_checkouts() {
  mkdir -p "$CHECKOUTS_DIR"

  local i checkout
  for i in 1 2 3 4; do
    checkout="$(checkout_path "$i")"

    if [[ -e "$checkout" ]]; then
      if git -C "$checkout" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        continue
      fi
      echo "error: $checkout exists but is not a git checkout"
      exit 1
    fi

    git -C "$PROJECT_DIR" worktree add --detach "$checkout" HEAD >/dev/null
  done
}

create_codex_window() {
  ensure_dev_checkouts

  local c1 c2 c3 c4
  c1="$(checkout_path 1)"
  c2="$(checkout_path 2)"
  c3="$(checkout_path 3)"
  c4="$(checkout_path 4)"

  local pane_top_left pane_top_right pane_bottom_left pane_bottom_right
  pane_top_left=$(tmux new-window -t "$SESSION" -n 'codex' -c "$c1" -P -F '#{pane_id}')
  pane_top_right=$(tmux split-window -h -l 50% -t "$pane_top_left" -c "$c2" -P -F '#{pane_id}')
  pane_bottom_left=$(tmux split-window -v -l 50% -t "$pane_top_left" -c "$c3" -P -F '#{pane_id}')
  pane_bottom_right=$(tmux split-window -v -l 50% -t "$pane_top_right" -c "$c4" -P -F '#{pane_id}')

  tmux send-keys -t "$pane_top_left" 'codex' C-m
  tmux send-keys -t "$pane_top_right" 'codex' C-m
  tmux send-keys -t "$pane_bottom_left" 'codex' C-m
  tmux send-keys -t "$pane_bottom_right" 'codex' C-m
}

if ! tmux has-session -t="$SESSION" 2>/dev/null; then
  tmux new-session -ds "$SESSION" -c "$PROJECT_DIR"
fi

FIRST_WINDOW_INDEX="$(tmux list-windows -t "$SESSION" -F '#{window_index}' | head -n1)"
FIRST_WINDOW_TARGET="$SESSION:$FIRST_WINDOW_INDEX"

# If layout already exists, skip re-creating panes/windows.
if window_exists 'dev'; then
  if ! window_exists 'codex'; then
    create_codex_window
  fi
  attach_or_switch
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

# Window 3: Codex (2x2 Grid) — 4 independent checkouts, each starts codex
create_codex_window

# Start on git window

tmux select-window -t "$SESSION:dev"
tmux select-pane -t "$PANE_GIT"

attach_or_switch
