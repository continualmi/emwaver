import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { WebSocketServer, type RawData, type WebSocket } from "ws";

const DEFAULT_PORT = 3921;
const REPO_ROOT = resolve(process.cwd(), "..");
const DEFAULT_SCRIPTS_DIR = join(REPO_ROOT, "assets", "default-scripts");
const CLIENT_DIST_DIR = resolve(process.cwd(), "dist", "client");

type JsonObject = Record<string, any>;
type LocalRole = "web" | "host" | "app";

const webs = new Set<WebSocket>();
const nativeApps = new Set<WebSocket>();
const daemonHosts = new Set<WebSocket>();
let agentUniverse: string | null = null;

class DaemonStartInputError extends Error {}

function numberEnv(name: string, fallback: number): number {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stringEnv(name: string): string {
  return String(process.env[name] || "").trim();
}

function normalizeAgentPayload(payload: JsonObject): JsonObject {
  const configuredUniverse = stringEnv("EMWAVER_AGENT_UNIVERSE") || stringEnv("CONTINUAL_AGENT_UNIVERSE");
  const universe = typeof payload.universe === "string" && payload.universe.trim()
    ? payload.universe.trim()
    : configuredUniverse || agentUniverse || "";
  const model = typeof payload.model === "string" && payload.model.trim()
    ? payload.model.trim()
    : stringEnv("EMWAVER_AGENT_MODEL") || "mdl-1-lite-frozen";
  const userInput = typeof payload.userInput === "string" && payload.userInput.trim()
    ? payload.userInput
    : typeof payload.prompt === "string"
      ? payload.prompt
      : "";

  return {
    model,
    ...(universe ? { universe } : {}),
    userInput,
    ...(Array.isArray(payload.tools) ? { tools: payload.tools } : {}),
    ...(payload.toolChoice ? { toolChoice: payload.toolChoice } : {}),
    ...(Array.isArray(payload.toolResults) ? { toolResults: payload.toolResults } : {}),
  };
}

function universeCreateEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.pathname.endsWith("/responses")) {
    url.pathname = `${url.pathname.slice(0, -"/responses".length)}/universes`;
    return url.toString();
  }
  url.pathname = `${url.pathname.replace(/\/$/, "").replace(/\/[^/]*$/, "")}/universes`;
  return url.toString();
}

function gatewayPort(): number {
  return numberEnv("EMWAVER_GATEWAY_PORT", DEFAULT_PORT);
}

function daemonStartCommand(extraArgs: string[] = []): { command: string; args: string[] } {
  const command = stringEnv("EMWAVER_CLI_BIN") || resolve(REPO_ROOT, "daemon", "dev");
  const configuredArgs = stringEnv("EMWAVER_GATEWAY_DAEMON_ARGS")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    command,
    args: ["daemon", "start", "--port", String(gatewayPort()), ...configuredArgs, ...extraArgs],
  };
}

function daemonStartArgs(payload: JsonObject): string[] {
  const args: string[] = [];
  const wifi = typeof payload.wifi === "string" ? payload.wifi.trim() : "";
  const wifiSecret = typeof payload.wifiSecret === "string" ? payload.wifiSecret.trim() : "";
  const wifiPortRaw = typeof payload.wifiPort === "number" || typeof payload.wifiPort === "string" ? String(payload.wifiPort).trim() : "";

  if (wifi || wifiSecret || wifiPortRaw) {
    if (!wifi) throw new DaemonStartInputError("Wi-Fi host or IP is required.");
    if (wifi.includes("://") || /[/\\?#@]/.test(wifi) || /\s/.test(wifi) || wifi.includes(":")) {
      throw new DaemonStartInputError("Wi-Fi host must be a bare hostname or IP address.");
    }
    if (!wifiSecret) throw new DaemonStartInputError("Wi-Fi pairing secret is required.");
    const wifiPort = wifiPortRaw ? Number(wifiPortRaw) : 3922;
    if (!Number.isInteger(wifiPort) || wifiPort < 1 || wifiPort > 65535) {
      throw new DaemonStartInputError("Wi-Fi port must be between 1 and 65535.");
    }
    args.push("--wifi", wifi, "--wifi-port", String(wifiPort), "--wifi-secret", wifiSecret);
  }

  return args;
}

function loadBundledExamples(): Array<{ name: string; source: string }> {
  if (!existsSync(DEFAULT_SCRIPTS_DIR)) return [];
  return readdirSync(DEFAULT_SCRIPTS_DIR)
    .filter((name) => name.endsWith(".emw"))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      source: readFileSync(join(DEFAULT_SCRIPTS_DIR, name), "utf8"),
    }));
}

async function readJsonBody(req: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  const parsed = JSON.parse(text);
  return parsed && typeof parsed === "object" ? parsed : {};
}

async function handleAgentRequest(payload: JsonObject): Promise<{ status: number; body: JsonObject }> {
  const apiKey = stringEnv("EMWAVER_AGENT_API_KEY");
  const endpoint = stringEnv("EMWAVER_AGENT_ENDPOINT") || stringEnv("CONTINUAL_AGENT_ENDPOINT");

  if (!apiKey || !endpoint) {
    return {
      status: 501,
      body: {
        error: "agent_not_configured",
        message: "Set EMWAVER_AGENT_API_KEY and EMWAVER_AGENT_ENDPOINT to enable paid Agent requests.",
      },
    };
  }

  if (!agentUniverse && !stringEnv("EMWAVER_AGENT_UNIVERSE") && !stringEnv("CONTINUAL_AGENT_UNIVERSE")) {
    const createResponse = await fetch(universeCreateEndpoint(endpoint), {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ storedPrompt: "emwaver-prompt", displayName: "EMWaver Gateway Agent" }),
    });
    const body = await createResponse.json().catch(() => ({}));
    if (!createResponse.ok || typeof body?.universe !== "string" || !body.universe.trim()) {
      return {
        status: createResponse.status || 502,
        body: {
          error: "agent_universe_create_failed",
          message: body?.message || body?.error || "Agent universe creation failed.",
        },
      };
    }
    agentUniverse = body.universe.trim();
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(normalizeAgentPayload(payload)),
  });

  const text = await response.text();
  let body: JsonObject;
  try {
    const parsed = JSON.parse(text);
    body = parsed && typeof parsed === "object" ? parsed : { message: text };
  } catch {
    body = { message: text };
  }

  return { status: response.status, body };
}

async function handleDaemonStartRequest(payload: JsonObject = {}): Promise<{ status: number; body: JsonObject }> {
  if (daemonHosts.size > 0) {
    return { status: 200, body: { ok: true, runtimeOwner: "emwaver-daemon", alreadyRunning: true } };
  }
  if (nativeApps.size > 0) {
    return { status: 200, body: { ok: true, runtimeOwner: "native-app", alreadyRunning: true } };
  }

  const { command, args } = daemonStartCommand(daemonStartArgs(payload));
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string; error?: string }>((resolveResult) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: process.env,
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
    child.on("error", (error) => resolveResult({ code: null, stdout, stderr, error: error.message }));
    child.on("close", (code) => resolveResult({ code, stdout, stderr }));
  });

  if (result.code !== 0) {
    return {
      status: 500,
      body: {
        ok: false,
        error: "daemon_start_failed",
        command,
        args,
        message: result.error || result.stderr || result.stdout || `daemon start exited with ${result.code}`,
      },
    };
  }

  return {
    status: 202,
    body: {
      ok: true,
      runtimeOwner: "emwaver-daemon",
      command,
      args,
      message: result.stdout.trim() || "daemon start requested",
    },
  };
}

function sendJson(ws: WebSocket, payload: JsonObject) {
  ws.send(JSON.stringify(payload));
}

function parseMessage(raw: RawData): JsonObject | null {
  try {
    const value = JSON.parse(String(raw));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function broadcast(targets: Set<WebSocket>, payload: JsonObject) {
  for (const ws of targets) {
    if (ws.readyState === ws.OPEN) sendJson(ws, payload);
  }
}

function appStatusPayload(): JsonObject {
  const nativeConnected = nativeApps.size > 0;
  const daemonConnected = daemonHosts.size > 0;
  return {
    type: "device.status",
    hostSessionId: "local",
    connected: nativeConnected || daemonConnected,
    runtimeOwner: nativeConnected ? "native-app" : daemonConnected ? "emwaver-daemon" : "none",
    devices: [
      ...(nativeConnected ? [{ id: "local-native-app", name: "EMWaver native app", connected: true }] : []),
      ...(daemonConnected ? [{ id: "local-daemon", name: "EMWaver daemon", connected: true }] : []),
    ],
  };
}

function forwardToApp(source: WebSocket, message: JsonObject) {
  const [nativeApp] = [...nativeApps].filter((ws) => ws.readyState === ws.OPEN);
  const [daemonHost] = [...daemonHosts].filter((ws) => ws.readyState === ws.OPEN);
  const runtimeOwner = nativeApp || daemonHost;
  if (!runtimeOwner) {
    sendJson(source, { type: "host.error", hostSessionId: "local", error: "native_app_offline" });
    return;
  }

  sendJson(runtimeOwner, {
    ...message,
    hostSessionId: "local",
  });
}

function handleWsMessage(ws: WebSocket, role: LocalRole, message: JsonObject) {
  const type = String(message.type || "");

  if (role === "web") {
    if (type === "hello") {
      sendJson(ws, { type: "hello.ack", role: "web", hostSessionId: "local" });
      sendJson(ws, appStatusPayload());
      return;
    }

    if (type === "script.run" || type === "script.stop" || type === "ui.event" || type === "plot.viewport") {
      forwardToApp(ws, message);
      return;
    }

    sendJson(ws, { type: "error", error: "unknown_message", messageType: type });
    return;
  }

  if (type === "hello") {
    sendJson(ws, { type: "hello.ack", role, hostSessionId: "local" });
    broadcast(webs, appStatusPayload());
    return;
  }

  broadcast(webs, {
    ...message,
    hostSessionId: "local",
  });
}

function contentType(filePath: string): string {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function serveClientAsset(pathname: string, res: ServerResponse): boolean {
  if (!existsSync(CLIENT_DIST_DIR)) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Gateway client has not been built. Run `npm run build:client` from gateway/.");
    return true;
  }

  const requested = pathname === "/" || pathname === "/index.html" ? "index.html" : pathname.slice(1);
  const filePath = resolve(CLIENT_DIST_DIR, requested);
  const safeRoot = `${CLIENT_DIST_DIR}/`;
  const resolvedIndex = join(CLIENT_DIST_DIR, "index.html");
  const finalPath = filePath === CLIENT_DIST_DIR || !filePath.startsWith(safeRoot) || !existsSync(filePath) || !statSync(filePath).isFile()
    ? resolvedIndex
    : filePath;

  if (!existsSync(finalPath)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
    return true;
  }

  res.writeHead(200, { "content-type": contentType(finalPath) });
  createReadStream(finalPath).pipe(res);
  return true;
}

const port = gatewayPort();
const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "emwaver-gateway", runtimeOwner: appStatusPayload().runtimeOwner }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/examples") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ examples: loadBundledExamples() }));
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/agent") {
    void (async () => {
      try {
        const payload = await readJsonBody(req);
        const result = await handleAgentRequest(payload);
        res.writeHead(result.status, { "content-type": "application/json" });
        res.end(JSON.stringify(result.body));
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "agent_request_failed", message: error instanceof Error ? error.message : String(error) }));
      }
    })();
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/daemon/start") {
    void (async () => {
      try {
        const payload = await readJsonBody(req);
        const result = await handleDaemonStartRequest(payload);
        res.writeHead(result.status, { "content-type": "application/json" });
        res.end(JSON.stringify(result.body));
      } catch (error) {
        const inputError = error instanceof DaemonStartInputError;
        res.writeHead(inputError ? 400 : 500, { "content-type": "application/json" });
        res.end(JSON.stringify({
          ok: false,
          error: inputError ? "daemon_start_invalid" : "daemon_start_failed",
          message: error instanceof Error ? error.message : String(error),
        }));
      }
    })();
    return;
  }

  serveClientAsset(url.pathname, res);
});

const wsServer = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname !== "/v1/ws") {
    socket.destroy();
    return;
  }

  wsServer.handleUpgrade(req, socket, head, (ws) => {
    let role: LocalRole | null = null;

    ws.on("message", (raw) => {
      const message = parseMessage(raw);
      if (!message) {
        sendJson(ws, { type: "error", error: "invalid_json" });
        return;
      }

      if (!role) {
        if (message.type !== "hello") {
          sendJson(ws, { type: "error", error: "expected_hello" });
          ws.close();
          return;
        }
        const requestedRole = String(message.role || "").toLowerCase();
        if (requestedRole !== "web" && requestedRole !== "host" && requestedRole !== "app") {
          sendJson(ws, { type: "error", error: "invalid_role" });
          ws.close();
          return;
        }
        role = requestedRole as LocalRole;
        if (role === "web") webs.add(ws);
        else if (role === "app") nativeApps.add(ws);
        else daemonHosts.add(ws);
      }

      handleWsMessage(ws, role, message);
    });

    ws.on("close", () => {
      if (role === "web") webs.delete(ws);
      if (role === "host" || role === "app") {
        daemonHosts.delete(ws);
        nativeApps.delete(ws);
        broadcast(webs, appStatusPayload());
      }
    });
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`EMWaver gateway listening on http://127.0.0.1:${port}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`EMWaver gateway port ${port} is already in use.`);
    console.error("Set EMWAVER_GATEWAY_PORT or run `emwaver gateway --port <port>` with a free port.");
    process.exit(1);
  }

  console.error("EMWaver gateway failed", error);
  process.exit(1);
});
