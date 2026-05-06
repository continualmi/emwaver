import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import WebSocket from "ws";

const port = 4921;
const agentPort = 4922;
const baseUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/v1/ws`;
const agentUrl = `http://127.0.0.1:${agentPort}/agent`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
  });
}

function getText(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        resolve({ status: res.statusCode, body });
      });
    });
    req.on("error", reject);
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 5000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await getJson(`${baseUrl}/health`);
      if (response.status === 200 && response.body?.ok === true) return;
    } catch (error) {
      lastError = error;
    }
    await wait(100);
  }
  throw lastError || new Error("gateway health timeout");
}

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        text += chunk;
      });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(text) });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function verifyIndexHtml() {
  const index = await getText(`${baseUrl}/`);
  if (index.status !== 200) {
    throw new Error(`unexpected index status: ${index.status}`);
  }
  const body = String(index.body || "");
  if (!body.includes("EMWaver Gateway") || !body.includes('id="root"')) {
    throw new Error("gateway index missing React app shell");
  }
  const scriptMatch = body.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/);
  if (!scriptMatch) {
    throw new Error("gateway index missing built client script");
  }
  const clientScript = await getText(`${baseUrl}${scriptMatch[1]}`);
  if (clientScript.status !== 200) {
    throw new Error(`unexpected client script status: ${clientScript.status}`);
  }
  const clientBody = String(clientScript.body || "");
  for (const required of [
    "EMWaver Gateway",
    "openFile",
    "Open",
    "Save",
    "Local Runtime",
    "Start Daemon",
    "Ask Agent",
    "plot.data",
    "textField",
    "textEditor",
    "logViewer",
    "No cloud relay required",
  ]) {
    if (!clientBody.includes(required)) {
      throw new Error(`gateway index missing required local UI marker: ${required}`);
    }
  }
  for (const forbidden of ["/api/auth", "/v1/files", "Cloud Files", "Sign in", "subscription"]) {
    if (body.includes(forbidden) || clientBody.includes(forbidden)) {
      throw new Error(`gateway index contains forbidden hosted/cloud marker: ${forbidden}`);
    }
  }
}

function verifyWebSocket() {
  return new Promise((resolve, reject) => {
    const app = new WebSocket(wsUrl);
    const ws = new WebSocket(wsUrl);
    const seen = [];
    let sawSnapshot = false;
    let sawPlotData = false;
    let appReady = false;
    let webReady = false;
    const timeout = setTimeout(() => {
      app.close();
      ws.close();
      reject(new Error(`timeout waiting for ui.snapshot; saw ${seen.map((m) => m.type).join(", ")}`));
    }, 5000);

    function maybeRun() {
      if (!appReady || !webReady) return;
      ws.send(JSON.stringify({
        type: "script.run",
        name: "verify.emw",
        source: "UI.render(UI.text({ text: \"hello\" }));",
      }));
    }

    app.on("open", () => {
      app.send(JSON.stringify({ type: "hello", role: "app", protocolVersion: 1, hostSessionId: "local" }));
    });

    app.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "hello.ack") {
        appReady = true;
        maybeRun();
        return;
      }
      if (msg.type === "script.run") {
        app.send(JSON.stringify({
          type: "script.started",
          hostSessionId: "local",
          scriptInstanceId: "verify-script-1",
          name: msg.name,
        }));
        app.send(JSON.stringify({
          type: "ui.snapshot",
          hostSessionId: "local",
          scriptInstanceId: "verify-script-1",
          rev: 1,
          root: {
            id: "root",
            type: "column",
            props: {},
            children: [
              { id: "verify-text", type: "text", props: { text: "hello" } },
              { id: "verify-plot", type: "plot", props: { xMin: 0, xMax: 10, yMin: 0, yMax: 1, bins: 4 } },
            ],
          },
          metadata: { owner: "mock-native-app" },
        }));
      }
      if (msg.type === "plot.viewport") {
        if (msg.targetNodeId !== "verify-plot" || msg.payload?.min !== 0 || msg.payload?.max !== 10) {
          clearTimeout(timeout);
          app.close();
          ws.close();
          reject(new Error(`unexpected plot.viewport: ${JSON.stringify(msg)}`));
          return;
        }
        app.send(JSON.stringify({
          type: "plot.data",
          hostSessionId: "local",
          scriptInstanceId: msg.scriptInstanceId,
          targetNodeId: msg.targetNodeId,
          xMin: msg.payload.min,
          xMax: msg.payload.max,
          dataX: [0, 5, 10],
          dataY: [0, 1, 0],
        }));
      }
      if (msg.type === "ui.event") {
        app.send(JSON.stringify({
          type: "ui.event.ack",
          hostSessionId: "local",
          scriptInstanceId: msg.scriptInstanceId,
          targetNodeId: msg.targetNodeId,
          name: msg.name,
          handled: true,
        }));
      }
    });

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "hello", role: "web", protocolVersion: 1 }));
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      seen.push(msg);
      if (msg.type === "hello.ack") {
        webReady = true;
        maybeRun();
      }
      if (msg.type === "ui.snapshot") {
        if (msg.root?.type !== "column" || msg.root?.children?.[0]?.props?.text !== "hello") {
          clearTimeout(timeout);
          app.close();
          ws.close();
          reject(new Error(`unexpected snapshot root: ${JSON.stringify(msg.root)}`));
          return;
        }
        sawSnapshot = true;
        ws.send(JSON.stringify({
          type: "plot.viewport",
          hostSessionId: "local",
          scriptInstanceId: msg.scriptInstanceId,
          baseRev: msg.rev,
          targetNodeId: "verify-plot",
          payload: { min: 0, max: 10, bins: 4 },
        }));
        ws.send(JSON.stringify({
          type: "ui.event",
          hostSessionId: "local",
          scriptInstanceId: msg.scriptInstanceId,
          baseRev: msg.rev,
          targetNodeId: "verify-node",
          name: "tap",
          payload: {},
        }));
      }
      if (msg.type === "plot.data" && msg.targetNodeId === "verify-plot") {
        sawPlotData = true;
      }
      if (msg.type === "ui.event.ack" && sawSnapshot && sawPlotData) {
        clearTimeout(timeout);
        app.close();
        ws.close();
        resolve(seen);
      }
    });

    ws.on("error", (error) => {
      clearTimeout(timeout);
      app.close();
      reject(error);
    });
    app.on("error", (error) => {
      clearTimeout(timeout);
      ws.close();
      reject(error);
    });
  });
}

async function withMockAgent(fn) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || (req.url !== "/agent" && req.url !== "/universes")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    requests.push({
      url: req.url,
      authorization: String(req.headers.authorization || ""),
      body,
    });
    if (req.url === "/universes") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ universe: "created-universe-1" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "mock agent ok", code: "UI.render(UI.text({ text: \"agent\" }));" }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(agentPort, "127.0.0.1", resolve);
  });

  try {
    await fn(requests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    EMWAVER_GATEWAY_PORT: String(port),
    EMWAVER_AGENT_API_KEY: "",
    EMWAVER_AGENT_ENDPOINT: "",
    EMWAVER_CLI_BIN: "/bin/echo",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

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
  const agentMissing = await postJson(`${baseUrl}/v1/agent`, { prompt: "hello" });
  if (agentMissing.status !== 501 || agentMissing.body?.error !== "agent_not_configured") {
    throw new Error(`unexpected missing-agent response: ${JSON.stringify(agentMissing)}`);
  }
  const daemonStart = await postJson(`${baseUrl}/v1/daemon/start`, {});
  if (daemonStart.status !== 202 || daemonStart.body?.ok !== true || daemonStart.body?.runtimeOwner !== "emwaver-daemon") {
    throw new Error(`unexpected daemon-start response: ${JSON.stringify(daemonStart)}`);
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
  console.log(`gateway verify passed: ${seen.map((m) => m.type).join(", ")}`);
} finally {
  child.kill("SIGTERM");
}

await withMockAgent(async (requests) => {
  const configuredGatewayPort = port + 2;
  const childWithAgent = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      EMWAVER_GATEWAY_PORT: String(configuredGatewayPort),
      EMWAVER_AGENT_API_KEY: "test-agent-key",
      EMWAVER_AGENT_ENDPOINT: agentUrl,
      EMWAVER_AGENT_UNIVERSE: "",
      CONTINUAL_AGENT_UNIVERSE: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const configuredBaseUrl = `http://127.0.0.1:${configuredGatewayPort}`;
  try {
    const earlyExit = once(childWithAgent, "exit").then(([code]) => {
      throw new Error(`configured gateway exited early with ${code}`);
    });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        const response = await getJson(`${configuredBaseUrl}/health`);
        if (response.status === 200 && response.body?.ok === true) break;
      } catch {}
      await wait(100);
    }
    await Promise.race([wait(0), earlyExit]);

    const response = await postJson(`${configuredBaseUrl}/v1/agent`, {
      mode: "debug",
      prompt: "debug",
      script: { name: "verify.emw", source: "UI.render(UI.text({ text: \"hello\" }));" },
    });
    if (response.status !== 200 || response.body?.message !== "mock agent ok") {
      throw new Error(`unexpected configured-agent response: ${JSON.stringify(response)}`);
    }
    if (requests.length !== 2 || requests.some((request) => request.authorization !== "Bearer test-agent-key")) {
      throw new Error(`unexpected mock agent request: ${JSON.stringify(requests)}`);
    }
    if (requests[0].url !== "/universes" || requests[0].body?.storedPrompt !== "emwaver-prompt") {
      throw new Error(`agent request did not create macOS-style universe: ${JSON.stringify(requests)}`);
    }
    if (
      requests[1].url !== "/agent" ||
      requests[1].body?.model !== "mdl-1-lite-frozen" ||
      requests[1].body?.universe !== "created-universe-1" ||
      requests[1].body?.userInput !== "debug"
    ) {
      throw new Error(`agent request did not include universe turn fields: ${JSON.stringify(requests[1].body)}`);
    }
    if ("script" in requests[1].body || "hardware" in requests[1].body || "runtime" in requests[1].body || "mode" in requests[1].body || "prompt" in requests[1].body) {
      throw new Error(`agent request leaked product-specific fields: ${JSON.stringify(requests[1].body)}`);
    }
    console.log("gateway agent proxy verify passed");
  } finally {
    childWithAgent.kill("SIGTERM");
  }
});
