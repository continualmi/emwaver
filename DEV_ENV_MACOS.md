# EMWaver macOS Dev Environment

This is my project-local setup checklist for bringing up EMWaver development on a fresh MacBook.

Scope:
- macOS only (no Ubuntu/Linux section)
- Developer workflows (this is not end-user/product documentation)

## 0) Quick Start (after tools are installed)

From the repo root:

```bash
# Backend (Flask)
cd backend
python -m pip install -r requirements.txt
export EMWAVER_AUTH_MODE=disabled
export OPENROUTER_API_KEY=...   # only if you call /api/agent/chat
python app.py
```

```bash
# Website (Next.js)
cd frontend
npm install
npm run dev
```

```bash
# Firmware (via internal CLI)
# Builds stm/emwaver-firmware/Release and updates firmware/emwaver.bin
emwaver build

# Flash firmware/emwaver.bin to a device in DFU mode
emwaver flash
```

## 1) Base System

### Homebrew

Install Homebrew:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Add brew to PATH (Homebrew will print the exact line for your machine). Typical Apple Silicon:

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
```

### Essential CLI tools

```bash
brew install git ripgrep fzf tmux neovim lazygit git-delta
```

Optional (nice-to-have):

```bash
brew install watch jq
```

## 2) Terminal (Ghostty)

- Install Ghostty from https://ghostty.org/ (or build from source).
- Ensure Option acts as Alt/Meta (for Vim/tmux muscle memory).

Ghostty config file is typically:

- `~/.config/ghostty/config`

Example setting:

```ini
# Option behaves like Alt (Meta)
macos-option-as-alt = left
```

## 3) Git / Diff UX (delta)

If you use `delta` as your pager, set it globally:

```bash
git config --global core.pager "delta --paging=never"
git config --global interactive.diffFilter "delta --color-only"
```

If you use LazyGit, it can be configured to use delta as well (optional).

## 4) Tmux

### TPM (Tmux Plugin Manager)

```bash
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
```

### Minimal tmux.conf

Put this in `~/.config/tmux/tmux.conf`:

```tmux
# Better colors
set-option -sa terminal-overrides ",xterm*:Tc"

# Mouse
set -g mouse on

# Start windows/panes at 1
set -g base-index 1
set -g pane-base-index 1
set-window-option -g pane-base-index 1
set-option -g renumber-windows on

# Alt+H / Alt+L to switch windows
bind -n M-H previous-window
bind -n M-L next-window

# Plugins
set -g @plugin 'tmux-plugins/tpm'
set -g @plugin 'tmux-plugins/tmux-sensible'

run '~/.tmux/plugins/tpm/tpm'
```

Reload:

```bash
tmux source-file ~/.config/tmux/tmux.conf
```

Install plugins: `Prefix` + `I`.

## 5) Tmux Sessionizer (EMWaver)

This is the fast project switcher (bound to Ctrl+f). It will:
- select a project folder
- create a tmux session if missing
- run the repo-local `.tmux-init` if present and executable

### Install the script

This is configured at `/usr/local/bin/tmux-sessionizer`.

To (re)create it, create `/usr/local/bin/tmux-sessionizer` (and make it executable):

```bash
sudo mkdir -p /usr/local/bin
sudo $EDITOR /usr/local/bin/tmux-sessionizer
sudo chmod +x /usr/local/bin/tmux-sessionizer
```

Verify it is discoverable on your PATH:

```bash
command -v tmux-sessionizer
```

Script contents:

```bash
#!/usr/bin/env bash

set -euo pipefail

selected="${1:-}"
if [[ -z "$selected" ]]; then
  # Keep this intentionally tight: only jump into EMWaver.
  selected=$(find ~/emwaver -mindepth 0 -maxdepth 0 -type d 2>/dev/null | fzf)
fi

if [[ -z "$selected" ]]; then
  exit 0
fi

selected_name="$(basename "$selected" | tr . _)"

ensure_session_exists() {
  if ! tmux has-session -t="$selected_name" 2>/dev/null; then
    tmux new-session -ds "$selected_name" -c "$selected"

    # Project-local layout hook
    if [[ -f "$selected/.tmux-init" && -x "$selected/.tmux-init" ]]; then
      "$selected/.tmux-init" "$selected_name"
    fi
  fi
}

ensure_session_exists

if [[ -z "${TMUX:-}" ]]; then
  tmux attach-session -t "$selected_name"
else
  tmux switch-client -t "$selected_name"
fi
```

### Bind Ctrl+f (zsh)

Add to `~/.zshrc`:

```bash
bindkey -s '^f' 'tmux-sessionizer\n'
```

Notes:
- This repo already includes `.tmux-init` at the root. The sessionizer will run it on first creation of the session.

## 6) Neovim

Install:

```bash
brew install neovim
```

Ensure your shell uses Neovim for `vi`:

```bash
echo "alias vi='nvim'" >> ~/.zshrc
```

### Minimal config (Lazy.nvim bootstrap)

If you already have your own config, keep it. If you want a baseline, ensure:
- leader is Space
- system clipboard is enabled
- Lazy.nvim is bootstrapped

Config location:
- `~/.config/nvim/init.lua`

Example baseline:

```lua
vim.g.mapleader = " "
vim.g.maplocalleader = " "

vim.opt.signcolumn = "yes"
vim.opt.clipboard = "unnamedplus"

-- Bootstrap lazy.nvim
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.loop.fs_stat(lazypath) then
  vim.fn.system({
    "git",
    "clone",
    "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git",
    "--branch=stable",
    lazypath,
  })
end
vim.opt.rtp:prepend(lazypath)

require("lazy").setup({
  { import = "plugins" },
})
```

Plugin ideas that work well with this repo:
- Telescope (fast file search + ripgrep)
- GitSigns or Fugitive (git integration)
- Treesitter (Rust/Swift/Java/TS)

## 7) Language / Platform Toolchains

### Xcode (iOS + macOS)

- Install Xcode from the App Store.
- Open Xcode once to finish installation.
- Install Command Line Tools:

```bash
xcode-select --install
```

### Rust (shared buffer core, CLI)

Install rustup:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

After install:

```bash
rustup update
```

Notes:
- Some crates in this repo use Rust edition 2024.
- iOS builds auto-install iOS Rust targets via Xcode build phases (see `ios/EMWaver/Native/README.md`).

Build the internal CLI:

```bash
cd cli
cargo build --release
```

Optional: install to PATH:

```bash
cargo install --path cli --bin emwaver --force
```

### Python (backend)

Install Python 3.14 and ensure `python` works (no venv).

Recommended: use `pyenv` so `python` resolves to the right version.

```bash
brew install pyenv
```

Add `pyenv` to your shell (zsh). Append to `~/.zshrc`:

```bash
export PYENV_ROOT="$HOME/.pyenv"
command -v pyenv >/dev/null || export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init -)"
```

Install and select Python 3.14:

```bash
pyenv install 3.14.0
pyenv global 3.14.0

python --version
python -m pip --version
```

If `pyenv install 3.14.0` isn't available yet on a fresh machine, use:

```bash
pyenv install 3.14-dev
pyenv global 3.14-dev
```

Install backend deps into that Python (global, not a venv):

```bash
cd backend
python -m pip install -r requirements.txt
```

### Node.js (frontend)

Install Node.js (recommend Node 20+).

If you use Homebrew:

```bash
brew install node
```

Then:

```bash
cd frontend
npm install
npm run dev
```

### Android (Android Studio)

- Install Android Studio.
- Install an SDK + platform tools from within Android Studio.

Repo note:
- Avoid running Gradle builds from the CLI unless you specifically need to; use Android Studio for normal iteration.

### STM32 Firmware tooling (CubeIDE)

- Install STM32CubeIDE (needed for the toolchain + project files).

Important:
- `emwaver build` currently prepends a STM32CubeIDE toolchain directory to PATH in code.
- On a fresh machine (or after CubeIDE updates), the embedded toolchain path may change.

If `emwaver build` fails due to missing `arm-none-eabi-gcc` or `arm-none-eabi-objcopy`, update the hardcoded path in:
- `cli/src/lib.rs`

## 8) Repo-local conveniences

### .tmux-init

This repo includes `.tmux-init` in the root; it sets up a multi-pane dev layout.

If you use the sessionizer above, it will run `.tmux-init` automatically when the tmux session is created.

### Secrets

Do not commit secrets.

- Local dev env vars can live in your shell env manager.
- This repo may include a local `.env` for your machine; keep it uncommitted.
