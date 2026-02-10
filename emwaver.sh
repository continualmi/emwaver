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
