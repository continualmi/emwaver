#!/usr/bin/env bash

set -euo pipefail

SESSION="${1:-emwaver}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$PROJECT_DIR/web"
ANDROID_DIR="$PROJECT_DIR/android"

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

session_created=0
if ! tmux has-session -t="$SESSION" 2>/dev/null; then
  tmux new-session -ds "$SESSION" -c "$WEB_DIR"
  session_created=1
fi

if window_exists 'emwaver'; then
  tmux select-window -t "$SESSION:emwaver"
  attach_or_switch
  exit 0
fi

FIRST_WINDOW_INDEX="$(tmux list-windows -t "$SESSION" -F '#{window_index}' | head -n1)"
FIRST_WINDOW_TARGET="$SESSION:$FIRST_WINDOW_INDEX"

pane_web=""
if (( session_created == 1 )); then
  tmux send-keys -t "$FIRST_WINDOW_TARGET" 'cd ' "$WEB_DIR" C-m
  tmux clear-history -t "$FIRST_WINDOW_TARGET"
  tmux rename-window -t "$FIRST_WINDOW_TARGET" 'emwaver'
  pane_web="$(tmux display-message -p -t "$FIRST_WINDOW_TARGET" '#{pane_id}')"
else
  pane_web="$(tmux new-window -t "$SESSION" -n 'emwaver' -c "$WEB_DIR" -P -F '#{pane_id}')"
fi

pane_android=$(tmux split-window -h -t "$pane_web" -c "$ANDROID_DIR" -P -F '#{pane_id}')

tmux send-keys -t "$pane_web" "cd $WEB_DIR" C-m
tmux send-keys -t "$pane_web" 'npm run dev' C-m

tmux send-keys -t "$pane_android" "cd $ANDROID_DIR" C-m
tmux send-keys -t "$pane_android" './gradlew installDebug'

tmux select-window -t "$SESSION:emwaver"
tmux select-pane -t "$pane_web"

attach_or_switch
