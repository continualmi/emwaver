#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREFIX="${EMWAVER_INSTALL_PREFIX:-$(mktemp -d /tmp/emwaver-install.XXXXXX)}"
PORT="${EMWAVER_GATEWAY_PORT:-3935}"
LOG_PATH="$(mktemp /tmp/emwaver-install-gateway.XXXXXX.log)"
STATE_DIR="$(mktemp -d /tmp/emwaver-install-state.XXXXXX)"
export EMWAVER_STATE_DIR="$STATE_DIR"
OWN_PREFIX=0

if [[ -z "${EMWAVER_INSTALL_PREFIX:-}" ]]; then
  OWN_PREFIX=1
fi

cleanup() {
  set +e
  if [[ -x "$PREFIX/bin/emw" ]]; then
    "$PREFIX/bin/emw" gateway stop >/dev/null 2>&1 || true
  fi
  if [[ -n "${GATEWAY_PID:-}" ]]; then
    pkill -TERM -P "$GATEWAY_PID" >/dev/null 2>&1 || true
    kill "$GATEWAY_PID" >/dev/null 2>&1 || true
    wait "$GATEWAY_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$LOG_PATH"
  rm -rf "$STATE_DIR"
  if [[ "$OWN_PREFIX" == "1" ]]; then
    rm -rf "$PREFIX"
  fi
}
trap cleanup EXIT

echo "== EMWaver install smoke =="
echo "repo: $ROOT"
echo "prefix: $PREFIX"
echo "port: $PORT"

EMWAVER_INSTALL_PREFIX="$PREFIX" "$ROOT/gateway/backend/install/install.sh"

test -x "$PREFIX/bin/emwaver"
test -x "$PREFIX/bin/emw"
test -f "$PREFIX/share/emwaver/gateway/dist/client/index.html"
test -f "$PREFIX/share/emwaver/assets/default-scripts/script_bootstrap.emw"

"$PREFIX/bin/emw" gateway serve --port "$PORT" --sim-device >"$LOG_PATH" 2>&1 &
GATEWAY_PID=$!

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

curl -fsS "http://127.0.0.1:$PORT/health"
echo
if ! node "$ROOT/scripts/verify-gateway-render.mjs" "$PORT" emwaver-gateway; then
  echo
  echo "== Gateway log =="
  cat "$LOG_PATH" || true
  exit 1
fi
echo "install smoke passed"
