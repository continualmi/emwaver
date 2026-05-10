#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${EMWAVER_GATEWAY_PORT:-3921}"
GATEWAY_LOG="$(mktemp /tmp/emwaver-gateway-sim.XXXXXX.log)"
STATE_DIR="$(mktemp -d /tmp/emwaver-gateway-sim-state.XXXXXX)"
export EMWAVER_STATE_DIR="$STATE_DIR"

cleanup() {
  set +e
  if [[ -n "${EMWAVER_BIN:-}" && -x "$EMWAVER_BIN" ]]; then
    "$EMWAVER_BIN" gateway stop >/dev/null 2>&1 || true
  fi
  if [[ -n "${GATEWAY_PID:-}" ]]; then
    kill "$GATEWAY_PID" >/dev/null 2>&1 || true
    wait "$GATEWAY_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$GATEWAY_LOG"
  rm -rf "$STATE_DIR"
}
trap cleanup EXIT

echo "== EMWaver Gateway simulator validation =="
echo "repo: $ROOT"
echo "port: $PORT"

echo
echo "== Build gateway =="
if [[ ! -d "$ROOT/gateway/frontend/node_modules" ]]; then
  (cd "$ROOT/gateway/frontend" && npm ci)
fi
(cd "$ROOT/gateway/frontend" && npm run build)

echo
echo "== Build Gateway backend =="
(cd "$ROOT/gateway/backend" && cargo build -p emwaver)
EMWAVER_BIN="$ROOT/gateway/backend/target/debug/emwaver"

echo
echo "== Start Gateway with simulator transport =="
"$EMWAVER_BIN" gateway serve --port "$PORT" --sim-device >"$GATEWAY_LOG" 2>&1 &
GATEWAY_PID=$!

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null

if ! node "$ROOT/scripts/verify-gateway-render.mjs" "$PORT" emwaver-gateway; then
  echo
  echo "== Gateway log =="
  cat "$GATEWAY_LOG" || true
  exit 1
fi
