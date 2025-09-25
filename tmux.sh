#!/bin/bash

SESSION="emwaver"

# Kill existing session if running
tmux kill-session -t "$SESSION" 2>/dev/null

# ── SOFTWARE WINDOW (sf) ──────────────────────────────────────────────
tmux new-session -d -s "$SESSION" -n sf -c .

# Split into 2x2 grid
tmux split-window -h  -t "$SESSION:sf"
tmux select-pane    -t "$SESSION:sf.0"
tmux split-window -v  -t "$SESSION:sf.0"
tmux select-pane    -t "$SESSION:sf.2"
tmux split-window -v  -t "$SESSION:sf.2"
tmux select-layout   -t "$SESSION:sf" tiled

# Pane 0: vim (repo root)
tmux send-keys -t "$SESSION:sf.0" 'vim ./' C-m

# Pane 1: git diff
tmux send-keys -t "$SESSION:sf.1" 'git diff' C-m

# Pane 2: cd into android
tmux send-keys -t "$SESSION:sf.2" 'cd android' C-m

# Pane 3: cd into ios
tmux send-keys -t "$SESSION:sf.3" 'cd ios' C-m

# ── FIRMWARE WINDOW (fw) ──────────────────────────────────────────────
tmux new-window -t "$SESSION" -n fw -c firmware

# Split into 2x2 grid
tmux split-window -h  -t "$SESSION:fw"
tmux select-pane    -t "$SESSION:fw.0"
tmux split-window -v  -t "$SESSION:fw.0"
tmux select-pane    -t "$SESSION:fw.2"
tmux split-window -v  -t "$SESSION:fw.2"
tmux select-layout   -t "$SESSION:fw" tiled

# Pane 0: vim
tmux send-keys -t "$SESSION:fw.0" 'vim ./' C-m

# Pane 1: git diff
tmux send-keys -t "$SESSION:fw.1" 'git diff' C-m

# Pane 2: codex
tmux send-keys -t "$SESSION:fw.2" 'codex' C-m

# Pane 3: codex
tmux send-keys -t "$SESSION:fw.3" 'codex' C-m

# ── Focus & attach ───────────────────────────────────────────────────
tmux select-window -t "$SESSION:sf"
tmux select-pane   -t "$SESSION:sf.0"
tmux attach-session -t "$SESSION"

