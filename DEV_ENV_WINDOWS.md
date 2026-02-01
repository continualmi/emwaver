# EMWaver Windows Dev Environment

This is the project-local setup checklist for bringing up EMWaver development on a Windows 11 machine.

Scope:
- Windows 11 only
- GUI-first workflow for the Windows app (Visual Studio 2022)
- CLI-first workflow for everything else via WSL2 (Ubuntu)

Repo location (recommended for this setup):
- Windows path: `C:\Users\<you>\emwaver`
- WSL path: `/mnt/c/Users/<you>/emwaver`

What you can develop from Windows:
- Windows app (WinUI 3 / Windows App SDK)
- Android app (Android Studio / Gradle)
- Website (Next.js / Node / npm)
- Backend (Python)
- STM32 firmware (STM32CubeIDE)
- Shared Rust crates (including Windows FFI DLL)

What you cannot develop from Windows:
- iOS app (requires macOS + Xcode)
- macOS app (requires macOS + Xcode)

## 0) Quick Start (after tools are installed)

From WSL (Ubuntu), from the repo root (`/mnt/c/Users/<you>/emwaver`):

Note: this repo includes `.tmux-init` which opens `vi` automatically; set up `vi -> nvim` first (see Neovim section).

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

### Windows app (WinUI 3)

Primary workflow: open `windows/EMWaver.sln` in Visual Studio 2022 and press Run.

This app loads a native Rust DLL from `windows/EMWaver/Native/`.
Build/copy that DLL with the repo helper script:

```powershell
powershell -ExecutionPolicy Bypass -File windows\build-rust-buffer-core.ps1 -Configuration Debug -Target x86_64-pc-windows-msvc
```

Then run the app from Visual Studio.

Note:
- The Rust DLL for the Windows app uses the Windows MSVC toolchain. Build it from Windows (PowerShell) using the script above.
- Everything else (git, scripts, backend, frontend) is easiest from WSL.

## 1) WSL2 + Ubuntu (recommended)

Install WSL2 and an Ubuntu distro, then open Ubuntu from Windows Terminal.

Verify:

```powershell
wsl --status
wsl -l -v
```

In WSL, update packages:

```bash
sudo apt update
sudo apt -y upgrade
```

### Essential CLI tools (WSL)

Install the same core tools as macOS (git, ripgrep, fzf, tmux, neovim, delta):

```bash
sudo apt -y install git ripgrep fzf tmux neovim
```

Install delta:

```bash
sudo apt -y install git-delta
```

Optional (nice-to-have):

```bash
sudo apt -y install jq watch
```

## 2) Git / Diff UX (delta)

If you use `delta` as your pager:

```bash
git config --global core.pager "delta --paging=never"
git config --global interactive.diffFilter "delta --color-only"
```

## 3) Tmux

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

## 4) Tmux Sessionizer (EMWaver)

This is the fast project switcher (bound to Ctrl+f). It will:
- select a project folder
- create a tmux session if missing
- run the repo-local `.tmux-init` if present and executable

### Install the script

Create `/usr/local/bin/tmux-sessionizer` (and make it executable):

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

# Keep this intentionally tight: only jump into EMWaver.
# Expected repo path (WSL view of Windows user dir):
#   /mnt/c/Users/<you>/emwaver
EMWAVER_ROOT="${EMWAVER_ROOT:-/mnt/c/Users/<you>/emwaver}"

selected="${1:-}"
if [[ -z "$selected" ]]; then
  selected=$(find "$EMWAVER_ROOT" -mindepth 0 -maxdepth 0 -type d 2>/dev/null | fzf)
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

Important:
- Set `EMWAVER_ROOT` in your `~/.bashrc` to your actual Windows username path, for example:

```bash
export EMWAVER_ROOT="/mnt/c/Users/alice/emwaver"
```

### Bind Ctrl+f

Bash (`~/.bashrc`):

```bash
bind -x '"\C-f":tmux-sessionizer'
```

If you use zsh in WSL, you can use the macOS-style binding:

```bash
bindkey -s '^f' 'tmux-sessionizer\n'
```

## 5) Neovim

Ensure your shell uses Neovim for `vi`:

```bash
echo "alias vi='nvim'" >> ~/.bashrc
echo "export EDITOR=nvim" >> ~/.bashrc
source ~/.bashrc
```

## 6) Visual Studio 2022 (Windows app)

Install Visual Studio 2022 with:
- Workload: ".NET desktop development"
- Workload: "Desktop development with C++" (for Windows SDK bits)
- Component: Windows App SDK / WinUI 3 support

Repo entrypoints:
- Solution: `windows/EMWaver.sln`
- Project: `windows/EMWaver/EMWaver.csproj`

Target framework (current): `net8.0-windows10.0.22621.0`.

## 7) .NET SDK (Windows)

Install .NET SDK 8.x.

Verify:

```bat
dotnet --version
```

## 8) Rust (Windows FFI DLL)

Install Rust via rustup and ensure you are using the MSVC toolchain.

Verify:

```bat
rustc --version
cargo --version
```

Build/copy the Windows FFI DLL into the WinUI project output:

```powershell
powershell -ExecutionPolicy Bypass -File windows\build-rust-buffer-core.ps1 -Configuration Debug -Target x86_64-pc-windows-msvc
```

Notes:
- The script builds `crates/emwaver-buffer-windows-ffi` and copies `emwaver_buffer_windows.dll` into `windows/EMWaver/Native/`.
- The WinUI project is set to copy `windows/EMWaver/Native/*.dll` to the output directory.

## 9) Node.js + npm (WSL or Windows)

If you follow the WSL workflow, install Node inside WSL (Node 20+).

You can use whichever Node version manager you prefer; keep Node 20+.

Verify:

```bash
node --version
npm --version
```

Dev server:

```bash
cd frontend
npm install
npm run dev
```

If you prefer Windows-native Node, the same commands work from PowerShell (repo root at `C:\Users\<you>\emwaver`):

```powershell
cd frontend
npm install
npm run dev
```

## 10) Python (backend)

If you follow the WSL workflow, install Python inside WSL.

Target Python: 3.14.

Recommended (WSL): use `pyenv` (mirrors the macOS workflow).

```bash
sudo apt -y install build-essential libssl-dev zlib1g-dev libbz2-dev libreadline-dev libsqlite3-dev curl git

curl https://pyenv.run | bash

# Then add pyenv init to ~/.bashrc (pyenv prints the exact lines), restart shell

pyenv install 3.14.0 || pyenv install 3.14-dev
pyenv global 3.14.0 || pyenv global 3.14-dev

python --version
python -m pip --version
```

Install backend deps:

```bash
cd backend
python -m pip install -r requirements.txt
```

If you prefer Windows-native Python, install Python 3.14 on Windows and run the same commands from PowerShell.

## 11) Android (optional on Windows)

- Install Android Studio.
- Install an SDK + platform tools from within Android Studio.

Notes:
- Android builds use Gradle via the repo's wrapper: `android/gradlew`.
- Prefer Android Studio for normal iteration.

## 12) STM32 Firmware tooling (optional on Windows)

- Install STM32CubeIDE (needed for the toolchain + project files).

Notes:
- On Windows, the simplest path is to build the firmware from STM32CubeIDE.
- The internal CLI command `emwaver build` currently hardcodes a macOS STM32CubeIDE toolchain path in `cli/src/lib.rs`. If you want `emwaver build` to work on Windows, you'll need to update that logic to find your Windows-installed `arm-none-eabi-gcc`/`arm-none-eabi-objcopy` (or make sure those tools are on PATH and stop overriding PATH).

## 13) Git

Install Git for Windows (or use the Git integration that ships with Visual Studio).

Verify:

```bat
git --version
```

## 14) AI Tooling (optional)

OpenCode is the primary assistant tool in this workflow.

Install (one-time):

- Windows: use the OpenCode Desktop (GUI).
- Authenticate with an OpenAI account (ChatGPT Plus subscription).
- Model: `openai/gpt-5.2` (GPT 5.2).

If you prefer the terminal workflow from WSL, install the OpenCode CLI inside WSL:

```bash
npm install -g opencode
```

Install OpenCode Desktop from:
- https://opencode.ai
