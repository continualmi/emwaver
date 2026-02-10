#!/usr/bin/env bash
set -euo pipefail

# EMWaver dev helper ("npm run dev" equivalent)
# Builds + runs the headless daemon CLI.
#
# Usage:
#   ./emwaver.sh devices
#   ./emwaver.sh daemon start
#   ./emwaver.sh daemon status
#
# Notes:
# - This is for repo/dev use. Packaged installs will provide `emwaver` on PATH.

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/daemon"

# Ensure Rust toolchain is available (common on macOS when using rustup)
if ! command -v cargo >/dev/null 2>&1; then
  if [[ -f "$HOME/.cargo/env" ]]; then
    # shellcheck disable=SC1090
    source "$HOME/.cargo/env"
  fi
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "error: cargo not found. Install Rust (rustup) or ensure cargo is on PATH." >&2
  exit 127
fi

cargo build -q -p emwaver-host -p emwaver

if [[ $# -eq 0 ]]; then
  echo "Usage: ./emwaver.sh <emwaver-args>"
  echo "Examples:"
  echo "  ./emwaver.sh devices"
  echo "  ./emwaver.sh daemon start"
  echo "  ./emwaver.sh daemon status"
  exit 0
fi

exec cargo run -q -p emwaver -- "$@"
