#!/usr/bin/env bash
set -euo pipefail

# Validate the Rust toolchain needed for EMWaver daemon/CLI/runtime work.
#
# This script intentionally does not install Rust. It reports the exact blocker
# so runtime extraction and CLI work can fail fast on machines without Cargo.

missing=0

if ! command -v cargo >/dev/null 2>&1; then
  echo "missing: cargo" >&2
  missing=1
else
  echo "cargo: $(cargo --version)"
fi

if ! command -v rustc >/dev/null 2>&1; then
  echo "missing: rustc" >&2
  missing=1
else
  echo "rustc: $(rustc --version)"
fi

if [[ "$missing" -ne 0 ]]; then
  cat >&2 <<'EOF'

Rust toolchain is required for:
- daemon/emwaver CLI build
- emwaver-runtime extraction
- emwaver-device extraction
- emwaver run
- real gateway/runtime integration

Install Rust with rustup or the platform package manager, then rerun:

  ./scripts/check-rust-toolchain.sh
  cd daemon && cargo build -p emwaver-host -p emwaver

EOF
  exit 1
fi

echo "Rust toolchain available."
