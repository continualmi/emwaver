#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${EMWAVER_GATEWAY_PORT:-3921}"
MODE="${EMWAVER_GATEWAY_DAEMON_SIM_MODE:-split}"
GATEWAY_LOG="$(mktemp /tmp/emwaver-gateway-sim.XXXXXX.log)"
DAEMON_LOG="$(mktemp /tmp/emwaver-daemon-sim.XXXXXX.log)"
STATE_DIR="$(mktemp -d /tmp/emwaver-gateway-sim-state.XXXXXX)"
export EMWAVER_STATE_DIR="$STATE_DIR"

cleanup() {
  set +e
  if [[ -n "${EMWAVER_BIN:-}" && -x "$EMWAVER_BIN" ]]; then
    "$EMWAVER_BIN" daemon stop >/dev/null 2>&1 || true
  fi
  if [[ -n "${GATEWAY_PID:-}" ]]; then
    kill "$GATEWAY_PID" >/dev/null 2>&1 || true
    wait "$GATEWAY_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${DAEMON_PID:-}" ]]; then
    kill "$DAEMON_PID" >/dev/null 2>&1 || true
    wait "$DAEMON_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$GATEWAY_LOG" "$DAEMON_LOG"
  rm -rf "$STATE_DIR"
}
trap cleanup EXIT

echo "== EMWaver gateway + daemon simulator validation =="
echo "repo: $ROOT"
echo "port: $PORT"
echo "mode: $MODE"

echo
echo "== Build gateway =="
if [[ ! -d "$ROOT/gateway/node_modules" ]]; then
  (cd "$ROOT/gateway" && npm ci)
fi
(cd "$ROOT/gateway" && npm run build)

echo
echo "== Build daemon CLI =="
(cd "$ROOT/daemon" && cargo build -p emwaver)
EMWAVER_BIN="$ROOT/daemon/target/debug/emwaver"

if [[ "$MODE" == "fallback" ]]; then
  echo
  echo "== Start CLI gateway with daemon fallback =="
  "$EMWAVER_BIN" gateway --port "$PORT" --daemon-fallback --sim-device >"$GATEWAY_LOG" 2>&1 &
  GATEWAY_PID=$!
else
  echo
  echo "== Start built gateway =="
  (cd "$ROOT/gateway" && EMWAVER_GATEWAY_PORT="$PORT" npm run start:built >"$GATEWAY_LOG" 2>&1) &
  GATEWAY_PID=$!
fi

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null

if [[ "$MODE" != "fallback" ]]; then
  echo
  echo "== Start daemon host with simulator transport =="
  "$EMWAVER_BIN" daemon serve --port "$PORT" --sim-device >"$DAEMON_LOG" 2>&1 &
  DAEMON_PID=$!
fi

if ! node "$ROOT/scripts/verify-gateway-daemon-render.mjs" "$PORT" emwaver-daemon; then
  echo
  echo "== Gateway log =="
  cat "$GATEWAY_LOG" || true
  if [[ "$MODE" != "fallback" ]]; then
    echo
    echo "== Daemon log =="
    cat "$DAEMON_LOG" || true
  fi
  exit 1
fi
