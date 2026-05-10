import { spawn } from "node:child_process";
import { once } from "node:events";
import { rmSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gatewayDir = path.resolve(frontendDir, "..");
const repoRoot = path.resolve(gatewayDir, "..");
const backendDir = path.join(gatewayDir, "backend");
const port = Number(process.env.EMWAVER_GATEWAY_VERIFY_PORT || "4921");
const baseUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/v1/ws`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function get(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
  });
}

function getJson(url) {
  return get(url).then((response) => ({
    status: response.status,
    body: JSON.parse(response.body),
  }));
}

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : {} }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 10000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await getJson(`${baseUrl}/health`);
      if (
        response.status === 200 &&
        response.body?.ok === true &&
        response.body?.runtimeOwner === "emwaver-gateway"
      ) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await wait(100);
  }
  throw lastError || new Error("gateway health timeout");
}

async function verifyIndexHtml() {
  const index = await get(`${baseUrl}/`);
  if (index.status !== 200) throw new Error(`unexpected index status: ${index.status}`);
  const body = String(index.body || "");
  if (!body.includes("EMWaver Gateway") || !body.includes('id="root"')) {
    throw new Error("gateway index missing React app shell");
  }
  const scriptMatch = body.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/);
  if (!scriptMatch) throw new Error("gateway index missing built client script");
  const clientScript = await get(`${baseUrl}${scriptMatch[1]}`);
  if (clientScript.status !== 200) throw new Error(`unexpected client script status: ${clientScript.status}`);
  const clientBody = String(clientScript.body || "");
  for (const required of [
    "EMWaver Gateway",
    "Files stay",
    "Open",
    "Save",
    "Local Runtime",
    "Use Wi-Fi target",
    "plot.data",
    "textField",
    "textEditor",
    "logViewer",
  ]) {
    if (!clientBody.includes(required)) {
      throw new Error(`gateway client missing required marker: ${required}`);
    }
  }
  for (const forbidden of [
    "/api/auth",
    "/v1/files",
    "/v1/" + "dae" + "mon/start",
    "/v1/" + "agent",
    "Start " + "dae" + "mon",
    "native " + "app",
    "emwaver-" + "dae" + "mon",
    "Cloud Files",
    "Sign in",
    "subscription",
  ]) {
    if (body.includes(forbidden) || clientBody.includes(forbidden)) {
      throw new Error(`gateway client contains forbidden marker: ${forbidden}`);
    }
  }
}

function findNodeById(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  if (!Array.isArray(node.children)) return null;
  for (const child of node.children) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return null;
}

function verifyWebSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const seen = [];
    let scriptId = "";
    let snapshots = 0;
    const source = `
var clicks = 0;
function render() {
  UI.render(UI.column({
    children: [
      UI.text({ id: "verify-text", text: "Clicks " + String(clicks) }),
      UI.button({ id: "verify-tap", label: "Tap", onTap: function () {
        clicks += 1;
        render();
      } })
    ]
  }));
}
render();
`;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`timeout waiting for gateway render; saw ${seen.map((m) => m.type).join(", ")}`));
    }, 10000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "hello", role: "web", protocolVersion: 1 }));
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      seen.push(msg);
      if (msg.type === "device.status") {
        if (msg.runtimeOwner !== "emwaver-gateway" || msg.connected !== true) {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(`unexpected device.status: ${JSON.stringify(msg)}`));
          return;
        }
      }
      if (msg.type === "hello.ack") {
        ws.send(JSON.stringify({ type: "script.run", name: "verify.emw", source }));
      }
      if (msg.type === "script.started") {
        scriptId = msg.scriptInstanceId;
      }
      if (msg.type === "script.error" || msg.type === "host.error" || msg.type === "error") {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(`gateway websocket error: ${JSON.stringify(msg)}`));
      }
      if (msg.type === "ui.snapshot" && msg.scriptInstanceId === scriptId) {
        snapshots += 1;
        const text = findNodeById(msg.root, "verify-text");
        if (!text) {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(`missing verify text node: ${JSON.stringify(msg.root)}`));
          return;
        }
        if (snapshots === 1) {
          const button = findNodeById(msg.root, "verify-tap");
          if (!button) {
            clearTimeout(timeout);
            ws.close();
            reject(new Error(`missing verify button: ${JSON.stringify(msg.root)}`));
            return;
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
        if (String(text.props?.text || "") !== "Clicks 1") {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(`unexpected second snapshot: ${JSON.stringify(text)}`));
          return;
        }
        clearTimeout(timeout);
        ws.close();
        resolve(seen);
      }
    });

    ws.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function verifyRejectedRoles() {
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("timeout waiting for invalid_role"));
    }, 5000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "hello", role: "app", protocolVersion: 1 }));
    });
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "error" && msg.error === "invalid_role") {
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
    });
    ws.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

const stateDir = path.join(repoRoot, ".tmp-gateway-verify-state");
const child = spawn(
  "cargo",
  ["run", "-q", "-p", "emwaver", "--", "gateway", "serve", "--port", String(port), "--sim-device"],
  {
    cwd: backendDir,
    env: {
      ...process.env,
      EMWAVER_STATE_DIR: stateDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += String(chunk);
});
child.stderr.on("data", (chunk) => {
  stderr += String(chunk);
});

try {
  const earlyExit = once(child, "exit").then(([code]) => {
    throw new Error(`gateway exited early with ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  });
  await Promise.race([waitForHealth(), earlyExit]);
  await verifyIndexHtml();
  const agentRoute = await postJson(`${baseUrl}/v1/${"agent"}`, { prompt: "hello" });
  if (agentRoute.status !== 404 || agentRoute.body?.error !== "not_found") {
    throw new Error(`Rust Gateway exposed an unexpected Agent route: ${JSON.stringify(agentRoute)}`);
  }
  const examples = await getJson(`${baseUrl}/v1/examples`);
  if (
    examples.status !== 200 ||
    !Array.isArray(examples.body?.examples) ||
    !examples.body.examples.some((example) => example.name === "hello.emw" && String(example.source || "").includes("UI.render"))
  ) {
    throw new Error(`unexpected examples response: ${JSON.stringify(examples)}`);
  }
  const seen = await verifyWebSocket();
  await verifyRejectedRoles();
  console.log(`gateway verify passed: ${seen.map((m) => m.type).join(", ")}`);
} finally {
  child.kill("SIGTERM");
  rmSync(stateDir, { recursive: true, force: true });
}
