# EMWaver Dev Environment (macOS + Windows 11)

This is the project-local setup checklist for bringing up EMWaver development.

Scope:
- macOS (native)
- Windows 11 with WSL2 (Ubuntu) for CLI workflows
- Developer workflows (this is not end-user/product documentation)

Repo location (recommended):
- macOS: `~/emwaver`
- Windows: `C:\Users\<you>\emwaver`
- WSL view of Windows path: `/mnt/c/Users/<you>/emwaver`

What you can develop:
- macOS: macOS app (Xcode), iOS app (Xcode), Android app, website, backend, STM32 firmware, shared Rust crates
- Windows: Windows app (Visual Studio 2022), Android app, website, backend, STM32 firmware, shared Rust crates (including Windows FFI DLL)

What you cannot develop:
- iOS/macOS apps from Windows (requires macOS + Xcode)
- Windows app from macOS (requires Windows 11 + Visual Studio 2022)

## 0) Quick Start (after tools are installed)

Common (shell):
- macOS: run in Terminal (zsh)
- Windows: run in WSL Ubuntu (bash/zsh)

From the repo root:

Note: this repo includes `.tmux-init` which opens `vi` automatically; set up `vi -> nvim` first (see Neovim section).

```bash
# Backend (Flask)
cd backend
python -m pip install -r ../requirements.txt
export EMWAVER_AUTH_MODE=disabled
export OPENROUTER_API_KEY=...   # only if you call /api/agent/chat
python app.py
```

### Windows-only backend dev (WSL2) reachable from other devices (macOS/iOS/Android)

Goal: run the Flask backend in WSL2 on your Windows machine, and access it from other devices on your home LAN (e.g. iPhone/Android, or a macOS laptop).

#### 1) Run Flask in WSL bound to all interfaces

From WSL (repo root):

```bash
cd backend
python -m pip install -r ../requirements.txt
export EMWAVER_AUTH_MODE=disabled

# IMPORTANT: point Flask at the real app module explicitly
export FLASK_APP=emw_backend.app

# Listen on all interfaces so Windows can forward and other devices can reach it
flask run --host 0.0.0.0 --port 5000
```

Sanity check inside WSL:

```bash
curl -i http://127.0.0.1:5000/health
```

#### 2) Find your Windows LAN IP

On Windows (PowerShell):

```powershell
ipconfig
```

Use the IPv4 for your active adapter (often `192.168.x.x`).

#### 3) If needed: forward Windows port 5000 -> WSL (classic WSL2 NAT)

WSL often has its own IP (e.g. `172.26.x.x`) that other LAN devices can’t route to directly. In that case, forward a port on Windows to the WSL IP.

First, get the WSL IP (from WSL):

```bash
ip addr show eth0
```

Then, in **Admin PowerShell** on Windows (replace `<WSL_IP>`):

```powershell
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=5000 connectaddress=<WSL_IP> connectport=5000
```

Allow inbound traffic through Windows Firewall:

```powershell
New-NetFirewallRule -DisplayName "EMWaver backend 5000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5000
```

#### 4) Test from macOS (or any LAN device)

From macOS:

```bash
curl -i http://<WINDOWS_LAN_IP>:5000/health
```

If that works, point your client app’s backend base URL to:
- `http://<WINDOWS_LAN_IP>:5000`

Notes:
- iOS/macOS may block plain HTTP due to App Transport Security (ATS). For local dev, you may need a debug-only ATS exception or put HTTPS in front (e.g. Caddy).
- If you change networks / reboot, the WSL IP may change; you may need to re-add/update the `portproxy` mapping.

```bash
# Website (Next.js)
cd frontend
npm install
npm run dev
```

Firmware (internal CLI, macOS only today):

```bash
# Builds stm/emwaver-firmware/Release and updates firmware/emwaver.bin
emwaver build

# Flash firmware/emwaver.bin to a device in DFU mode
emwaver flash
```

Windows app (WinUI 3):
- Open `windows/EMWaver.sln` in Visual Studio 2022 and press Run.
- Build/copy the Rust DLL:

```powershell
# (Removed) windows\\build-rust-buffer-core.ps1 — Rust buffer-core DLL no longer used
```

## 1) Base System

### macOS: Homebrew + essential tools

Install Homebrew:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Add brew to PATH (Homebrew prints the exact line for your machine). Typical Apple Silicon:

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Install essential CLI tools:

```bash
brew install git ripgrep fzf tmux neovim git-delta
```

Optional:

```bash
brew install watch jq
```

### Windows 11: WSL2 + Ubuntu + essential tools

Install WSL2 and an Ubuntu distro, then open Ubuntu from Windows Terminal.

Verify:

```powershell
wsl --status
wsl -l -v
```

In WSL:

```bash
sudo apt update
sudo apt -y upgrade
sudo apt -y install git ripgrep fzf tmux neovim git-delta lazygit
```

If you run Android Gradle tasks inside WSL (optional):

```bash
sudo apt -y install openjdk-17-jdk
echo "export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64" >> ~/.bashrc
echo "export PATH=\"$JAVA_HOME/bin:$PATH\"" >> ~/.bashrc
source ~/.bashrc
java -version
```

Gradle note:
- Prefer the project wrapper (`android/gradlew`). You usually do not need a system Gradle.
- If you still want one in WSL (not required, can be old):

```bash
sudo apt -y install gradle
gradle --version
```

Notes:
- The repo root `.tmux-init` opens a `lazygit` pane; install it so the layout works out of the box.
- Some Ubuntu distros/repos may not include `lazygit` (or may ship an older version). If `lazygit` is missing, install the latest binary to `~/.local/bin`:

```bash
mkdir -p ~/.local/bin
python3 - <<'PY' > /tmp/_lazygit_url.txt
import json, re, urllib.request
url='https://api.github.com/repos/jesseduffield/lazygit/releases/latest'
with urllib.request.urlopen(url) as r:
  data=json.load(r)
for a in data.get('assets', []):
  name=a.get('name','')
  if re.search(r'lazygit_.*_linux_x86_64\\.tar\\.gz$', name):
    print(a['browser_download_url'])
    break
PY
curl -L -o /tmp/lazygit.tar.gz "$(cat /tmp/_lazygit_url.txt)"
tar -xzf /tmp/lazygit.tar.gz -C /tmp
install -m 0755 /tmp/lazygit ~/.local/bin/lazygit
rm -f /tmp/lazygit.tar.gz /tmp/_lazygit_url.txt
```

Optional:

```bash
sudo apt -y install jq watch
```

## 2) AI Tooling (optional)

OpenCode is the primary assistant tool in this workflow.

### Azure CLI

macOS:

```bash
brew update
brew install azure-cli
az version
```

Linux (Ubuntu/Debian):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl apt-transport-https lsb-release gnupg

sudo mkdir -p /etc/apt/keyrings
curl -sLS https://packages.microsoft.com/keys/microsoft.asc \
  | gpg --dearmor \
  | sudo tee /etc/apt/keyrings/microsoft.gpg > /dev/null
sudo chmod go+r /etc/apt/keyrings/microsoft.gpg

AZ_REPO=$(lsb_release -cs)
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/microsoft.gpg] https://packages.microsoft.com/repos/azure-cli/ ${AZ_REPO} main" \
  | sudo tee /etc/apt/sources.list.d/azure-cli.list

sudo apt-get update
sudo apt-get install -y azure-cli

az version
```

Login (headless-friendly):

```bash
az login --use-device-code
az account show
```

### GitHub CLI (gh)

macOS:

```bash
brew update
brew install gh
gh --version
```

Linux (Ubuntu/Debian):

```bash
sudo apt-get update
sudo apt-get install -y gh
gh --version
```

Login:

```bash
gh auth login
gh auth status
```

### OpenClaw (assistant gateway) — verbose by default

If you're using OpenClaw and want **verbose** output enabled by default, edit your gateway config:

- Config path: `~/.openclaw/openclaw.json`
- Set:

```json
{
  "agents": {
    "defaults": {
      "verboseDefault": "on"
    }
  }
}
```

Apply it:

```bash
openclaw gateway restart
```

Model:
- `openai/gpt-5.2` (GPT 5.2)

macOS (terminal workflow):

```bash
npm install -g opencode
```

Windows:
- OpenCode Desktop (GUI) from https://opencode.ai
- If you want the terminal workflow, install OpenCode CLI inside WSL:

```bash
npm install -g opencode
```

## 3) Git / Diff UX (delta)

If you use `delta` as your pager:

```bash
git config --global core.pager "delta --paging=never"
git config --global interactive.diffFilter "delta --color-only"
```

WSL note (lazygit integration):
- Ensure `delta` is installed (`git-delta` package provides the `delta` binary).
- Configure lazygit to use delta by creating/editing `~/.config/lazygit/config.yml`:

```yaml
git:
  paging:
    colorArg: always
    pager: delta --paging=never
```

If `delta` is missing and you don't want to use `sudo`, install the latest `delta` binary to `~/.local/bin`:

```bash
mkdir -p ~/.local/bin
python3 - <<'PY' > /tmp/_delta_url.txt
import json, re, urllib.request
url='https://api.github.com/repos/dandavison/delta/releases/latest'
with urllib.request.urlopen(url) as r:
  data=json.load(r)
for a in data.get('assets', []):
  name=a.get('name','')
  if re.search(r'delta-.*-x86_64-unknown-linux-musl\.tar\.gz$', name):
    print(a['browser_download_url'])
    break
PY
curl -L -o /tmp/delta.tar.gz "$(cat /tmp/_delta_url.txt)"
tar -xzf /tmp/delta.tar.gz -C /tmp
install -m 0755 /tmp/delta-*/delta ~/.local/bin/delta
rm -f /tmp/delta.tar.gz /tmp/_delta_url.txt
```

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

Create `/usr/local/bin/tmux-sessionizer` (and make it executable):

```bash
sudo mkdir -p /usr/local/bin
sudo $EDITOR /usr/local/bin/tmux-sessionizer
sudo chmod +x /usr/local/bin/tmux-sessionizer
```

Script contents (macOS + WSL):

```bash
#!/usr/bin/env bash

set -euo pipefail

selected="${1:-}"

if [[ -z "$selected" ]]; then
  # macOS default: ~/emwaver
  # WSL default: /mnt/c/Users/<you>/emwaver
  EMWAVER_ROOT="${EMWAVER_ROOT:-${HOME}/emwaver}"
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

WSL note:
- Set `EMWAVER_ROOT` to your Windows user path in WSL, for example:

```bash
export EMWAVER_ROOT="/mnt/c/Users/alice/emwaver"
```

### Bind Ctrl+f

macOS (zsh `~/.zshrc`):

```bash
bindkey -s '^f' 'tmux-sessionizer\n'
```

WSL (bash `~/.bashrc`):

```bash
bind -x '"\C-f":tmux-sessionizer'
```

## 6) Neovim

Ensure `vi` uses Neovim.

macOS (zsh):

```bash
echo "alias vi='nvim'" >> ~/.zshrc
echo "export EDITOR=nvim" >> ~/.zshrc
source ~/.zshrc
```

WSL (bash):

```bash
echo "alias vi='nvim'" >> ~/.bashrc
echo "export EDITOR=nvim" >> ~/.bashrc
source ~/.bashrc
```

If you want a full Neovim baseline (Lazy.nvim + Telescope/Harpoon/etc.), add a shared `nvim/` doc later (or copy the config from your dotfiles).

WSL note:
- This repo does not ship a Neovim config.
- If file icons look wrong ("tofu" squares / misaligned glyphs), your terminal font is missing Nerd Font glyphs. Install a Nerd Font on Windows and set your terminal to use it (Windows Terminal: Settings -> Profiles -> Defaults -> Appearance -> Font face).
- If tmux is involved, make sure tmux is using a truecolor-capable terminal:

```tmux
set -g default-terminal "tmux-256color"
set-option -sa terminal-overrides ",xterm*:Tc"
```
- If you want a minimal baseline quickly (includes `nvim-tree`), you can generate one locally under `~/.config/nvim`:

```bash
mkdir -p ~/.config/nvim/lua/emw
cat > ~/.config/nvim/init.lua <<'EOF'
vim.g.mapleader = " "
vim.g.maplocalleader = " "

vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.termguicolors = true
vim.opt.mouse = "a"
vim.opt.clipboard = "unnamedplus"

require("emw.lazy")

vim.keymap.set("n", "<leader>e", function()
  require("nvim-tree.api").tree.toggle({ find_file = true, focus = true })
end)
EOF

cat > ~/.config/nvim/lua/emw/lazy.lua <<'EOF'
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
  { "nvim-tree/nvim-tree.lua", dependencies = { "nvim-tree/nvim-web-devicons" } },
})
EOF
```

## 7) Language / Platform Toolchains

### Rust

Install rustup:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup update
```

Build the internal CLI:

```bash
cd cli
cargo build --release
```

Optional: install to PATH:

```bash
cargo install --path cli --bin emwaver --force
```

Windows app note:
- (Removed) Rust buffer-core DLL: Windows buffering is now implemented in managed code; no Rust build step required.

### Python (backend)

Target Python: 3.14.

macOS (recommended): use `pyenv`:

```bash
brew install pyenv
```

Append to `~/.zshrc`:

```bash
export PYENV_ROOT="$HOME/.pyenv"
command -v pyenv >/dev/null || export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init -)"
```

Then:

```bash
pyenv install 3.14.0 || pyenv install 3.14-dev
pyenv global 3.14.0 || pyenv global 3.14-dev
python --version
python -m pip --version
```

WSL (recommended): use `pyenv` similarly.

```bash
sudo apt -y install build-essential libssl-dev zlib1g-dev libbz2-dev libreadline-dev libsqlite3-dev curl
curl https://pyenv.run | bash
```

Then follow pyenv's printed instructions to enable it in your shell, and install Python 3.14.

### Node.js (frontend)

Node 20+.

macOS:

```bash
brew install node
```

WSL:
- Install Node 20+ using your preferred approach (nvm/fnm/apt repo).

### Android

- Install Android Studio.
- Install an SDK + platform tools from within Android Studio.

### STM32 Firmware tooling

- Install STM32CubeIDE.

Also install the ARM GNU binutils so we can convert the built firmware `.elf` into a distributable `.bin`:

macOS:
```bash
brew install arm-none-eabi-binutils
```

Ubuntu / WSL:
```bash
sudo apt-get update
sudo apt-get install -y binutils-arm-none-eabi
```

Notes:
- On Windows, the simplest path is to build the firmware from STM32CubeIDE.
- `stm/update_firmware_bins.sh` uses `arm-none-eabi-objcopy` to generate `firmware/emwaver.bin` and the per-platform bundled copies.
- `emwaver build` currently hardcodes a macOS STM32CubeIDE toolchain path in `cli/src/lib.rs`.

## 8) Platform IDEs

### macOS: Xcode (iOS + macOS)

- Install Xcode from the App Store.
- Open Xcode once to finish installation.
- Install Command Line Tools:

```bash
xcode-select --install
```

### Windows: Visual Studio 2022 (Windows app)

Install Visual Studio 2022 with:
- Workload: ".NET desktop development"
- Workload: "Desktop development with C++" (for Windows SDK bits)
- Component: Windows App SDK / WinUI 3 support

Repo entrypoints:
- Solution: `windows/EMWaver.sln`
- Project: `windows/EMWaver/EMWaver.csproj`

Target framework (current): `net8.0-windows10.0.22621.0`.

Install .NET SDK 8.x.

Verify:

```bat
dotnet --version
```

## 9) Repo-local conveniences

### .tmux-init

This repo includes `.tmux-init` in the root; it sets up a multi-pane dev layout.

If you use the sessionizer above, it will run `.tmux-init` automatically when the tmux session is created.

### Secrets

Do not commit secrets.

- Local dev env vars can live in your shell env manager.
- This repo may include a local `.env` for your machine; keep it uncommitted.
