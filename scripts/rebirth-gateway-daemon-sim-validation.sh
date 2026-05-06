#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${EMWAVER_GATEWAY_PORT:-3921}"
GATEWAY_LOG="$(mktemp /tmp/emwaver-gateway-sim.XXXXXX.log)"
DAEMON_LOG="$(mktemp /tmp/emwaver-daemon-sim.XXXXXX.log)"

cleanup() {
  set +e
  if [[ -n "${GATEWAY_PID:-}" ]]; then
    kill "$GATEWAY_PID" >/dev/null 2>&1 || true
    wait "$GATEWAY_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${DAEMON_PID:-}" ]]; then
    kill "$DAEMON_PID" >/dev/null 2>&1 || true
    wait "$DAEMON_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$GATEWAY_LOG" "$DAEMON_LOG"
}
trap cleanup EXIT

echo "== EMWaver gateway + daemon simulator validation =="
echo "repo: $ROOT"
echo "port: $PORT"

echo
echo "== Build gateway =="
(cd "$ROOT/gateway" && npm run build)

echo
echo "== Build daemon CLI =="
(cd "$ROOT/daemon" && cargo build -p emwaver)

echo
echo "== Start built gateway =="
(cd "$ROOT/gateway" && EMWAVER_GATEWAY_PORT="$PORT" npm run start:built >"$GATEWAY_LOG" 2>&1) &
GATEWAY_PID=$!

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null

echo
echo "== Start daemon host with simulator transport =="
(cd "$ROOT/daemon" && cargo run -q -p emwaver -- daemon serve --port "$PORT" --sim-device >"$DAEMON_LOG" 2>&1) &
DAEMON_PID=$!

node - "$ROOT" "$PORT" <<'NODE'
const path = require("node:path");
const root = process.argv[2];
const port = process.argv[3];
const WebSocket = require(path.join(root, "gateway/node_modules/ws"));

const source = `
var clicks = 0;
pinMode(13, OUTPUT);
digitalWrite(13, HIGH);
function render() {
  UI.render(UI.column({
    children: [
      UI.text({ text: "Gateway daemon simulator" }),
      UI.text({ text: String(analogRead(0)) }),
      UI.button({ id: "sim.tap", label: "Tap", onTap: function () {
        clicks += 1;
        render();
      } })
    ]
  }));
}
render();
`;

const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`);
let scriptId = null;
let snapshots = 0;
let sentRun = false;

const timeout = setTimeout(() => {
  console.error("timeout waiting for gateway/daemon simulator result");
  process.exit(1);
}, 10000);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "hello", role: "web", protocolVersion: 1 }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.type === "hello.ack") {
    return;
  }
  if (msg.type === "device.status" && msg.connected && !sentRun) {
    sentRun = true;
    ws.send(JSON.stringify({ type: "script.run", name: "gateway-daemon-sim.emw", source }));
    return;
  }
  if (msg.type === "script.started") {
    scriptId = msg.scriptInstanceId;
    return;
  }
  if (msg.type === "script.error" || msg.type === "host.error") {
    console.error(JSON.stringify(msg));
    process.exit(1);
  }
  if (msg.type === "ui.snapshot" && msg.scriptInstanceId === scriptId) {
    snapshots += 1;
    if (snapshots === 1) {
      const button = msg.root.children.find((node) => node.id === "sim.tap");
      ws.send(JSON.stringify({
        type: "ui.event",
        scriptInstanceId: scriptId,
        targetNodeId: button.id,
        name: "tap",
        payload: {},
      }));
      return;
    }
    clearTimeout(timeout);
    console.log("gateway daemon simulator validation passed");
    ws.close();
  }
});

ws.on("close", () => process.exit(snapshots >= 2 ? 0 : 1));
NODE
