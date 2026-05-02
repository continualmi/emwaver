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

function verifyWebSocket() {
  return new Promise((resolve, reject) => {
    const app = new WebSocket(wsUrl);
    const ws = new WebSocket(wsUrl);
    const seen = [];
    let sawSnapshot = false;
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
          root: { type: "text", props: { text: "hello" } },
          metadata: { owner: "mock-native-app" },
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
        if (msg.root?.type !== "text" || msg.root?.props?.text !== "hello") {
          clearTimeout(timeout);
          app.close();
          ws.close();
          reject(new Error(`unexpected snapshot root: ${JSON.stringify(msg.root)}`));
          return;
        }
        sawSnapshot = true;
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
      if (msg.type === "ui.event.ack" && sawSnapshot) {
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
    if (req.method !== "POST" || req.url !== "/agent") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    requests.push({
      authorization: String(req.headers.authorization || ""),
      body,
    });
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
  const agentMissing = await postJson(`${baseUrl}/v1/agent`, { prompt: "hello" });
  if (agentMissing.status !== 501 || agentMissing.body?.error !== "agent_not_configured") {
    throw new Error(`unexpected missing-agent response: ${JSON.stringify(agentMissing)}`);
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
    if (requests.length !== 1 || requests[0].authorization !== "Bearer test-agent-key") {
      throw new Error(`unexpected mock agent request: ${JSON.stringify(requests)}`);
    }
    if (requests[0].body?.script?.name !== "verify.emw") {
      throw new Error(`agent request did not include script context: ${JSON.stringify(requests[0].body)}`);
    }
    console.log("gateway agent proxy verify passed");
  } finally {
    childWithAgent.kill("SIGTERM");
  }
});
