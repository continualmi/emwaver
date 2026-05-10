#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
GATEWAY_BACKEND_DIR="$ROOT/gateway/backend"
GATEWAY_FRONTEND_DIR="$ROOT/gateway/frontend"
PREFIX="${EMWAVER_INSTALL_PREFIX:-$HOME/.local}"
BIN_DIR="$PREFIX/bin"
SHARE_DIR="$PREFIX/share/emwaver"
GATEWAY_SHARE_DIR="$SHARE_DIR/gateway"
ASSETS_SHARE_DIR="$SHARE_DIR/assets/default-scripts"
INSTALL_SERVICE="${EMWAVER_INSTALL_SERVICE:-0}"
SERVICE_ARGS="${EMWAVER_SERVICE_ARGS:-}"

if ! command -v cargo >/dev/null 2>&1; then
  echo "missing: cargo" >&2
  echo "Install Rust first, then rerun this script." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "missing: node" >&2
  echo "Install Node.js so the Gateway frontend assets can be built." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "missing: npm" >&2
  echo "Install npm so gateway dependencies can be prepared." >&2
  exit 1
fi

echo "== EMWaver local CLI installer =="
echo "repo:   $ROOT"
echo "prefix: $PREFIX"

echo
echo "== Build CLI =="
cargo build --manifest-path "$GATEWAY_BACKEND_DIR/Cargo.toml" -p emwaver --release

mkdir -p "$BIN_DIR"
cp -f "$GATEWAY_BACKEND_DIR/target/release/emwaver" "$BIN_DIR/emwaver"
chmod +x "$BIN_DIR/emwaver"
echo "installed: $BIN_DIR/emwaver"
ln -sf emwaver "$BIN_DIR/emw"
echo "installed: $BIN_DIR/emw -> emwaver"

echo
echo "== Prepare gateway dependencies =="
if [[ -f "$GATEWAY_FRONTEND_DIR/package-lock.json" ]]; then
  (cd "$GATEWAY_FRONTEND_DIR" && npm ci)
else
  (cd "$GATEWAY_FRONTEND_DIR" && npm install)
fi
(cd "$GATEWAY_FRONTEND_DIR" && npm run build)

echo
echo "== Install gateway assets =="
rm -rf "$GATEWAY_SHARE_DIR"
mkdir -p "$GATEWAY_SHARE_DIR"
cp -f "$GATEWAY_FRONTEND_DIR/package.json" "$GATEWAY_SHARE_DIR/package.json"
if [[ -f "$GATEWAY_FRONTEND_DIR/package-lock.json" ]]; then
  cp -f "$GATEWAY_FRONTEND_DIR/package-lock.json" "$GATEWAY_SHARE_DIR/package-lock.json"
fi
cp -R "$GATEWAY_FRONTEND_DIR/dist" "$GATEWAY_SHARE_DIR/dist"
echo "installed gateway: $GATEWAY_SHARE_DIR"

echo
echo "== Install default scripts =="
rm -rf "$ASSETS_SHARE_DIR"
mkdir -p "$ASSETS_SHARE_DIR"
cp -R "$ROOT/assets/default-scripts/." "$ASSETS_SHARE_DIR/"
echo "installed default scripts: $ASSETS_SHARE_DIR"

if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo
  echo "Add this to PATH if needed:"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
fi

if [[ "$INSTALL_SERVICE" == "1" ]]; then
  echo
  echo "== Install systemd user service =="
  # shellcheck disable=SC2086
  "$BIN_DIR/emwaver" service install $SERVICE_ARGS
fi

cat <<EOF

Done.

Try:
  $BIN_DIR/emw doctor
  $BIN_DIR/emw gateway serve --sim-device

For hardware:
  $BIN_DIR/emw gateway serve --device 0
  $BIN_DIR/emw gateway serve --ble
EOF
