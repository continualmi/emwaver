import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const { WebSocket } = require(path.join(repoRoot, "gateway", "node_modules", "ws"));

const port = process.argv[2] || "3921";
const expectedRuntimeOwner = process.argv[3] || "emwaver-daemon";

const source = `
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

const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`);
let scriptId = null;
let snapshots = 0;
let sentRun = false;
let sawRuntimeOwner = false;

const timeout = setTimeout(() => {
  console.error("timeout waiting for gateway daemon render");
  process.exit(1);
}, 10000);

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
    ws.send(JSON.stringify({ type: "script.run", name: "packaged-daemon-render.emw", source }));
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
      const button = msg.root.children.find((node) => node.id === "packaged.tap");
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

ws.on("close", () => {
  process.exit(sawRuntimeOwner && snapshots >= 2 ? 0 : 1);
});
