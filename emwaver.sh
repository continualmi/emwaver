#!/usr/bin/env bash
set -euo pipefail

# EMWaver dev helper + installer for the daemon CLI.
#
# Usage:
#   ./emwaver.sh devices
#   ./emwaver.sh daemon start
#   ./emwaver.sh daemon status
#   ./emwaver.sh install
#   ./emwaver.sh install --prefix ~/.local

ROOT="$(cd "$(dirname "$0")" && pwd)"
DAEMON_DIR="$ROOT/daemon"

ensure_cargo() {
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
}

print_usage() {
  cat <<'USAGE'
Usage: ./emwaver.sh <command>

Commands:
  install [--prefix <dir>] [--force]
      Build + install `emwaver` and `emwaver-host` to <prefix>/bin.
      Default prefix: ~/.local

  <emwaver args...>
      Build and run the local dev CLI.

Examples:
  ./emwaver.sh devices
  ./emwaver.sh daemon start
  ./emwaver.sh daemon status
  ./emwaver.sh install
USAGE
}

install_cli() {
  local prefix="$HOME/.local"
  local force_flag=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --prefix)
        [[ $# -ge 2 ]] || { echo "error: --prefix requires a value" >&2; exit 2; }
        prefix="$2"
        shift 2
        ;;
      --force)
        force_flag="--force"
        shift
        ;;
      -h|--help)
        cat <<'HELP'
Install emwaver CLI + daemon host binaries.

Options:
  --prefix <dir>   Install root. Binaries go to <dir>/bin (default: ~/.local)
  --force          Overwrite existing binaries in prefix
HELP
        return 0
        ;;
      *)
        echo "error: unknown install option: $1" >&2
        exit 2
        ;;
    esac
  done

  ensure_cargo

  echo "Installing emwaver into: $prefix/bin"
  cargo install --path "$DAEMON_DIR/emwaver" --root "$prefix" $force_flag
  cargo install --path "$DAEMON_DIR/emwaver-host" --root "$prefix" $force_flag

  echo
  echo "✅ Installed binaries:"
  echo "   - $prefix/bin/emwaver"
  echo "   - $prefix/bin/emwaver-host"

  case ":$PATH:" in
    *":$prefix/bin:"*)
      echo "PATH already includes $prefix/bin"
      ;;
    *)
      echo ""
      echo "Add to PATH (if needed):"
      echo "  export PATH=\"$prefix/bin:\$PATH\""
      ;;
  esac

  echo ""
  echo "Then run: emwaver devices"
}

main() {
  if [[ $# -eq 0 ]]; then
    print_usage
    exit 0
  fi

  case "$1" in
    install)
      shift
      install_cli "$@"
      ;;
    -h|--help|help)
      print_usage
      ;;
    *)
      ensure_cargo
      cd "$DAEMON_DIR"
      cargo build -q -p emwaver-host -p emwaver
      exec cargo run -q -p emwaver -- "$@"
      ;;
  esac
}

main "$@"
