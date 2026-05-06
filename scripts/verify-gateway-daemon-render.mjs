import path from "node:path";
import process from "node:process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const { WebSocket } = require(path.join(repoRoot, "gateway", "node_modules", "ws"));

const port = process.argv[2] || "3921";
const expectedRuntimeOwner = process.argv[3] || "emwaver-daemon";
const sourcePath = process.argv[4] || "";
const eventTargetId = process.argv[5] || "packaged.tap";
const timeoutMs = Number(process.env.EMWAVER_GATEWAY_RENDER_TIMEOUT_MS || "30000");

const defaultSource = `
var clicks = 0;
pinMode(13, OUTPUT);
digitalWrite(13, HIGH);
function render() {
  UI.render(UI.column({
    children: [
      UI.text({ text: "Packaged daemon render" }),
      UI.text({ text: String(analogRead(0)) }),
      UI.button({ id: "packaged.tap", label: "Tap", onTap: function () {
        clicks += 1;
        render();
      } })
    ]
  }));
}
render();
`;
const source = sourcePath ? readFileSync(sourcePath, "utf8") : defaultSource;
const scriptName = sourcePath ? path.basename(sourcePath) : "packaged-daemon-render.emw";

function findNodeById(node, id) {
  if (!node || typeof node !== "object") {
    return null;
  }
  if (node.id === id) {
    return node;
  }
  if (!Array.isArray(node.children)) {
    return null;
  }
  for (const child of node.children) {
    const found = findNodeById(child, id);
    if (found) {
      return found;
    }
  }
  return null;
}

const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`);
let scriptId = null;
let snapshots = 0;
let sentRun = false;
let sawRuntimeOwner = false;

const timeout = setTimeout(() => {
  console.error(`timeout waiting for gateway daemon render after ${timeoutMs}ms`);
  console.error(JSON.stringify({ sawRuntimeOwner, sentRun, scriptId, snapshots }));
  process.exit(1);
}, timeoutMs);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "hello", role: "web", protocolVersion: 1 }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.type === "device.status" && msg.runtimeOwner === expectedRuntimeOwner) {
    sawRuntimeOwner = true;
  }
  if (msg.type === "device.status" && msg.connected && !sentRun) {
    sentRun = true;
    ws.send(JSON.stringify({ type: "script.run", name: scriptName, source }));
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
      const button = findNodeById(msg.root, eventTargetId);
      if (!button) {
        console.error(`missing UI event target: ${eventTargetId}`);
        process.exit(1);
      }
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
    console.log(`gateway daemon render passed (${expectedRuntimeOwner})`);
    ws.close();
  }
});

ws.on("error", (err) => {
  console.error(`websocket error: ${err.message}`);
});

ws.on("close", () => {
  process.exit(sawRuntimeOwner && snapshots >= 2 ? 0 : 1);
});
