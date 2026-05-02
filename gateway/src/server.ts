import { createServer, type IncomingMessage } from "node:http";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type RawData, type WebSocket } from "ws";

const DEFAULT_PORT = 3921;
const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SRC_DIR, "..", "..");
const DEFAULT_SCRIPTS_DIR = join(REPO_ROOT, "assets", "default-scripts");

type JsonObject = Record<string, any>;
type LocalRole = "web" | "host" | "app";

const webs = new Set<WebSocket>();
const apps = new Set<WebSocket>();

function numberEnv(name: string, fallback: number): number {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stringEnv(name: string): string {
  return String(process.env[name] || "").trim();
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

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
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
  return {
    type: "device.status",
    hostSessionId: "local",
    connected: apps.size > 0,
    runtimeOwner: "native-app",
    devices: apps.size > 0 ? [{ id: "local-native-app", name: "EMWaver native app", connected: true }] : [],
  };
}

function forwardToApp(source: WebSocket, message: JsonObject) {
  const [app] = [...apps].filter((ws) => ws.readyState === ws.OPEN);
  if (!app) {
    sendJson(source, { type: "host.error", hostSessionId: "local", error: "native_app_offline" });
    return;
  }

  sendJson(app, {
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

  // Native app owns real runtime/device execution. Anything it emits is relayed to browser clients.
  broadcast(webs, {
    ...message,
    hostSessionId: "local",
  });
}

const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>EMWaver Gateway</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0d1114;
        --panel: #151a1f;
        --panel-2: #1b2228;
        --line: #303b43;
        --line-2: #43515a;
        --text: #eef2f3;
        --muted: #9ba8ad;
        --accent: #8edbd4;
        --accent-2: #d9f4ef;
        --danger: #f1a7a0;
        --warn: #f3ce8a;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        overflow: hidden;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--text);
      }
      button, select, input, textarea { font: inherit; }
      button {
        border: 1px solid var(--line-2);
        border-radius: 8px;
        background: var(--panel-2);
        color: var(--text);
        font-weight: 700;
        padding: 8px 10px;
        cursor: pointer;
      }
      button.primary { background: var(--accent-2); color: #0c1416; border-color: var(--accent-2); }
      button.danger { color: #1a0e0d; background: var(--danger); border-color: var(--danger); }
      button:disabled { cursor: not-allowed; opacity: 0.45; }
      textarea {
        width: 100%;
        height: 100%;
        min-height: 0;
        resize: none;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #0f1418;
        color: var(--text);
        padding: 12px;
        font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        outline: none;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .shell { display: grid; grid-template-rows: auto minmax(0, 1fr); height: 100vh; }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        border-bottom: 1px solid var(--line);
        background: #11171b;
        padding: 14px 18px;
      }
      h1 { margin: 0; font-size: 18px; letter-spacing: 0; }
      .sub { color: var(--muted); font-size: 13px; padding-top: 2px; }
      .status { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; font-weight: 700; }
      .dot { width: 9px; height: 9px; border-radius: 999px; background: var(--line-2); }
      .dot.open { background: var(--accent); }
      .dot.error { background: var(--danger); }
      .main { display: grid; grid-template-columns: 280px minmax(0, 1fr) 360px; gap: 12px; min-height: 0; padding: 12px; }
      .panel { min-height: 0; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); overflow: hidden; }
      .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--line); padding: 10px 12px; font-size: 13px; font-weight: 800; }
      .panel-body { height: calc(100% - 42px); min-height: 0; overflow: auto; padding: 12px; }
      .examples { display: grid; gap: 8px; }
      .example { width: 100%; text-align: left; }
      .example.active { border-color: var(--accent); }
      .sidebar-stack { display: grid; gap: 14px; }
      .side-section { display: grid; gap: 8px; }
      .side-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--muted); font-size: 12px; font-weight: 800; text-transform: uppercase; }
      .device-card { border: 1px solid var(--line); border-radius: 8px; background: #11171b; padding: 10px; }
      .device-name { color: var(--text); font-size: 13px; font-weight: 800; }
      .device-meta { color: var(--muted); font-size: 12px; padding-top: 2px; }
      .editor-panel { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; }
      .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--line); padding: 10px 12px; }
      .toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .filename { min-width: 0; color: var(--muted); font-size: 13px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .editor-body { min-height: 0; padding: 12px; }
      .preview { display: grid; gap: 10px; }
      .node { border: 1px solid var(--line); border-radius: 8px; background: #11171b; padding: 10px; }
      .ui-column { display: flex; flex-direction: column; }
      .ui-row { display: flex; align-items: center; flex-wrap: wrap; }
      .ui-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .ui-text { color: var(--text); }
      .ui-muted { color: var(--muted); }
      .ui-control { width: 100%; }
      .ui-field { display: grid; gap: 6px; }
      .ui-label { color: var(--muted); font-size: 12px; font-weight: 800; }
      .ui-input {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #0f1418;
        color: var(--text);
        padding: 8px 10px;
      }
      .ui-editor { min-height: 160px; height: 160px; }
      .ui-card, .ui-tile { border: 1px solid var(--line); border-radius: 8px; background: #11171b; padding: 12px; }
      .ui-card { display: flex; flex-direction: column; gap: 10px; }
      .ui-tile { display: flex; flex-direction: column; gap: 6px; width: 100%; text-align: left; }
      .ui-tile-title, .ui-card-title { color: var(--muted); font-size: 12px; font-weight: 800; }
      .ui-tile-value { color: var(--text); font-size: 14px; }
      .ui-scroll { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 8px; background: #0f1418; overflow: auto; }
      .ui-divider { height: 1px; width: 100%; background: var(--line); }
      .ui-progress { display: grid; gap: 6px; }
      .ui-progress-track { height: 8px; overflow: hidden; border-radius: 999px; background: var(--panel-2); }
      .ui-progress-fill { height: 100%; background: var(--accent); }
      .ui-log { border: 1px solid var(--line); border-radius: 8px; background: #0f1418; padding: 10px; color: var(--muted); }
      .plot-card { display: grid; gap: 8px; border: 1px solid var(--line); border-radius: 8px; background: #0f1418; padding: 10px; }
      .plot-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--muted); font-size: 12px; font-weight: 800; }
      .plot-surface { width: 100%; border: 1px solid var(--line); border-radius: 8px; background: #0b1013; overflow: hidden; touch-action: none; user-select: none; }
      .plot-svg { display: block; width: 100%; height: 100%; }
      .plot-help { color: var(--muted); font-size: 11px; }
      .log { display: grid; gap: 8px; }
      .log-entry { border-bottom: 1px solid var(--line); padding-bottom: 8px; color: var(--muted); }
      .agent-box { display: grid; gap: 8px; }
      .agent-input { min-height: 78px; height: 78px; }
      .agent-output { border: 1px solid var(--line); border-radius: 8px; background: #0f1418; padding: 10px; color: var(--muted); }
      .error { color: var(--danger); }
      .warning { color: var(--warn); }
      @media (max-width: 1100px) {
        body { overflow: auto; }
        .shell { height: auto; min-height: 100vh; }
        .main { grid-template-columns: 1fr; }
        .panel { min-height: 280px; }
        .editor-panel { min-height: 560px; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header>
        <div>
          <h1>EMWaver Gateway</h1>
          <div class="sub">Localhost controller for the native EMWaver macOS/Windows app. No cloud relay required.</div>
        </div>
        <div class="status"><span id="dot" class="dot"></span><span id="status">disconnected</span></div>
      </header>
      <main class="main">
        <aside class="panel">
          <div class="panel-head"><span>Scripts</span><span class="sub">bundled</span></div>
          <div class="panel-body">
            <div class="sidebar-stack">
              <div class="side-section">
                <div id="examples" class="examples"></div>
              </div>
              <div class="side-section">
                <div class="side-title"><span>Native App</span><span id="deviceStatusLabel">offline</span></div>
                <div id="deviceStatus" class="device-card">
                  <div class="device-name">Waiting for EMWaver app</div>
                  <div class="device-meta">Start the native app on this machine to run scripts against hardware.</div>
                </div>
              </div>
            </div>
          </div>
        </aside>
        <section class="panel editor-panel">
          <div class="toolbar">
            <div class="toolbar-left"><span id="filename" class="filename">hello.emw</span></div>
            <div class="toolbar-right">
              <input id="openFile" type="file" accept=".emw,text/plain" style="display: none" />
              <button id="open">Open</button>
              <button id="save">Save</button>
              <button id="run" class="primary">Run</button>
              <button id="stop" class="danger">Stop</button>
            </div>
          </div>
          <div class="editor-body"><textarea id="source"></textarea></div>
        </section>
        <aside class="panel">
          <div class="panel-head"><span>Live UI</span><span id="rev" class="sub">rev 0</span></div>
          <div class="panel-body">
            <div id="preview" class="preview"><div class="ui-muted">Connect the native app and run a script to render UI.</div></div>
            <div style="height: 16px"></div>
            <div class="panel-head" style="margin: 0 -12px; border-top: 1px solid var(--line);"><span>Agent</span><span class="sub">optional</span></div>
            <div class="agent-box" style="padding-top: 12px">
              <textarea id="agentPrompt" class="agent-input" placeholder="Ask the Agent to write, debug, or explain this .emw script."></textarea>
              <button id="askAgent">Ask Agent</button>
              <div id="agentOutput" class="agent-output">Configure EMWAVER_AGENT_API_KEY and EMWAVER_AGENT_ENDPOINT to enable paid Agent requests. Local hardware control stays available without them.</div>
            </div>
            <div style="height: 16px"></div>
            <div class="panel-head" style="margin: 0 -12px; border-top: 1px solid var(--line);"><span>Protocol</span></div>
            <div id="log" class="log" style="padding-top: 12px"></div>
          </div>
        </aside>
      </main>
    </div>
    <script>
      let examples = [
        { name: "hello.emw", source: 'UI.render(UI.text({ text: "hello" }));' }
      ];
      const log = document.getElementById("log");
      const preview = document.getElementById("preview");
      const status = document.getElementById("status");
      const dot = document.getElementById("dot");
      const source = document.getElementById("source");
      const filename = document.getElementById("filename");
      const rev = document.getElementById("rev");
      const examplesEl = document.getElementById("examples");
      const deviceStatusEl = document.getElementById("deviceStatus");
      const deviceStatusLabel = document.getElementById("deviceStatusLabel");
      const agentPrompt = document.getElementById("agentPrompt");
      const agentOutput = document.getElementById("agentOutput");
      let selectedName = examples[0].name;
      let scriptInstanceId = "";
      let currentRev = 0;
      let plotDataByNodeId = {};
      const plotViews = {};
      const plotTimers = {};
      const plotDrags = {};
      const ws = new WebSocket((location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + "/v1/ws");

      function setStatus(value, kind) {
        status.textContent = value;
        dot.className = "dot" + (kind ? " " + kind : "");
      }

      function appendLog(msg) {
        const entry = document.createElement("div");
        entry.className = "log-entry";
        const pre = document.createElement("pre");
        pre.textContent = JSON.stringify(msg, null, 2);
        entry.appendChild(pre);
        log.prepend(entry);
        while (log.children.length > 20) log.removeChild(log.lastChild);
      }

      function loadExample(example) {
        selectedName = example.name;
        filename.textContent = example.name;
        source.value = example.source;
        for (const child of examplesEl.children) child.classList.toggle("active", child.dataset.name === example.name);
      }

      async function loadExamples() {
        try {
          const response = await fetch("/v1/examples");
          if (!response.ok) return;
          const body = await response.json();
          if (Array.isArray(body.examples) && body.examples.length > 0) examples = body.examples;
        } catch {}
      }

      function renderExamples() {
        examplesEl.innerHTML = "";
        for (const example of examples) {
          const button = document.createElement("button");
          button.className = "example";
          button.dataset.name = example.name;
          button.textContent = example.name;
          button.onclick = () => loadExample(example);
          examplesEl.appendChild(button);
        }
        loadExample(examples[0]);
      }

      function spacingStyle(el, props) {
        if (typeof props.spacing === "number") el.style.gap = props.spacing + "px";
        if (typeof props.padding === "number") el.style.padding = props.padding + "px";
      }

      function sizeStyle(el, props) {
        if (typeof props.height === "number") el.style.height = props.height + "px";
        if (typeof props.maxHeight === "number") el.style.maxHeight = props.maxHeight + "px";
        if (typeof props.minColumnWidth === "number" && el.classList.contains("ui-grid")) {
          el.style.gridTemplateColumns = "repeat(auto-fit, minmax(" + props.minColumnWidth + "px, 1fr))";
        } else if (typeof props.columns === "number" && props.columns > 0 && el.classList.contains("ui-grid")) {
          el.style.gridTemplateColumns = "repeat(" + Math.floor(props.columns) + ", minmax(0, 1fr))";
        }
      }

      function finiteNumber(value, fallback) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
      }

      function nodeId(node, fallback) {
        return String(node && (node.id || (node.props && node.props.id)) || fallback || "");
      }

      function collectPlotNodes(node, out) {
        if (!node || typeof node !== "object") return;
        if (node.type === "plot") out.push(node);
        const children = Array.isArray(node.children) ? node.children : [];
        for (const child of children) collectPlotNodes(child, out);
      }

      function requestPlotViewport(targetNodeId, range, bins) {
        if (!ws || ws.readyState !== WebSocket.OPEN || !scriptInstanceId || !targetNodeId) return;
        ws.send(JSON.stringify({
          type: "plot.viewport",
          hostSessionId: "local",
          scriptInstanceId,
          baseRev: currentRev,
          targetNodeId,
          payload: {
            min: range.min,
            max: range.max,
            bins: bins || 400
          }
        }));
      }

      function schedulePlotViewport(targetNodeId, range, bins) {
        plotViews[targetNodeId] = range;
        if (plotTimers[targetNodeId]) clearTimeout(plotTimers[targetNodeId]);
        plotTimers[targetNodeId] = setTimeout(() => {
          plotTimers[targetNodeId] = null;
          requestPlotViewport(targetNodeId, range, bins);
        }, 120);
      }

      function clearObject(value) {
        for (const key of Object.keys(value)) delete value[key];
      }

      function renderPlotNode(node, props) {
        const targetNodeId = nodeId(node, props.id || "plot");
        const plot = plotDataByNodeId[targetNodeId] || {};
        const yMin = finiteNumber(props.yMin, -128);
        const yMax = finiteNumber(props.yMax, 384);
        const xMin = finiteNumber(plot.xMin ?? props.xMin, 0);
        const xMax = finiteNumber(plot.xMax ?? props.xMax, xMin + 1);
        const view = plotViews[targetNodeId] || { min: xMin, max: xMax > xMin ? xMax : xMin + 1 };
        plotViews[targetNodeId] = view;

        const dataX = Array.isArray(plot.dataX || props.dataX) ? (plot.dataX || props.dataX).map(Number).filter(Number.isFinite) : [];
        const dataY = Array.isArray(plot.dataY || props.dataY) ? (plot.dataY || props.dataY).map(Number).filter(Number.isFinite) : [];
        const pointCount = Math.min(dataX.length, dataY.length);
        const w = 1000;
        const h = 200;
        const span = Math.max(1e-9, view.max - view.min);
        const ySpan = Math.max(1e-9, yMax - yMin);
        const points = [];
        for (let i = 0; i < pointCount; i += 1) {
          const x = dataX[i];
          const y = dataY[i];
          const px = ((x - view.min) / span) * w;
          const py = (1 - ((y - yMin) / ySpan)) * h;
          if (Number.isFinite(px) && Number.isFinite(py)) points.push(px.toFixed(2) + "," + py.toFixed(2));
        }

        const card = document.createElement("div");
        card.className = "plot-card";
        const head = document.createElement("div");
        head.className = "plot-head";
        const title = document.createElement("div");
        title.textContent = String(props.title || props.id || "Plot");
        const range = document.createElement("div");
        range.textContent = "x [" + Math.round(view.min) + " .. " + Math.round(view.max) + "]";
        head.appendChild(title);
        head.appendChild(range);
        card.appendChild(head);

        if (props.errorText) {
          const err = document.createElement("div");
          err.className = "error";
          err.textContent = String(props.errorText);
          card.appendChild(err);
        }

        const surface = document.createElement("div");
        surface.className = "plot-surface";
        surface.style.height = (typeof props.height === "number" && Number.isFinite(props.height) ? props.height : 260) + "px";
        const svgNs = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNs, "svg");
        svg.setAttribute("class", "plot-svg");
        svg.setAttribute("viewBox", "0 0 " + w + " " + h);
        svg.setAttribute("preserveAspectRatio", "none");
        if (points.length > 1) {
          const polyline = document.createElementNS(svgNs, "polyline");
          polyline.setAttribute("fill", "none");
          polyline.setAttribute("stroke", "var(--accent)");
          polyline.setAttribute("stroke-width", "2");
          polyline.setAttribute("stroke-linejoin", "round");
          polyline.setAttribute("stroke-linecap", "round");
          polyline.setAttribute("points", points.join(" "));
          svg.appendChild(polyline);
        } else {
          const text = document.createElementNS(svgNs, "text");
          text.setAttribute("x", "20");
          text.setAttribute("y", "40");
          text.setAttribute("fill", "var(--muted)");
          text.setAttribute("font-size", "24");
          text.textContent = "waiting for plot.data...";
          svg.appendChild(text);
        }
        surface.appendChild(svg);

        surface.onwheel = (event) => {
          event.preventDefault();
          const rect = surface.getBoundingClientRect();
          const t = (event.clientX - rect.left) / Math.max(1, rect.width);
          const zoom = Math.exp(Number(event.deltaY || 0) * 0.002);
          const nextSpan = Math.max(1, span * zoom);
          const anchor = view.min + t * span;
          const next = { min: anchor - t * nextSpan, max: anchor - t * nextSpan + nextSpan };
          schedulePlotViewport(targetNodeId, next, finiteNumber(props.bins, 400));
          renderSnapshot(lastSnapshotRoot);
        };
        surface.onmousedown = (event) => {
          event.preventDefault();
          plotDrags[targetNodeId] = { x0: event.clientX, min: view.min, max: view.max };
        };
        surface.onmousemove = (event) => {
          const drag = plotDrags[targetNodeId];
          if (!drag) return;
          event.preventDefault();
          const rect = surface.getBoundingClientRect();
          const dragSpan = Math.max(1e-9, drag.max - drag.min);
          const delta = (-(event.clientX - drag.x0) / Math.max(1, rect.width)) * dragSpan;
          const next = { min: drag.min + delta, max: drag.max + delta };
          schedulePlotViewport(targetNodeId, next, finiteNumber(props.bins, 400));
          renderSnapshot(lastSnapshotRoot);
        };
        surface.onmouseup = () => { delete plotDrags[targetNodeId]; };
        surface.onmouseleave = () => { delete plotDrags[targetNodeId]; };

        card.appendChild(surface);
        const help = document.createElement("div");
        help.className = "plot-help";
        help.textContent = "Drag to pan. Wheel to zoom. Data stays on the local native app and is streamed as compressed plot.data.";
        card.appendChild(help);
        return card;
      }

      function renderNode(node) {
        if (!node || typeof node !== "object") {
          const empty = document.createElement("div");
          empty.className = "ui-muted";
          empty.textContent = "No UI.render(...) found.";
          return empty;
        }
        const props = node.props || {};
        const children = Array.isArray(node.children) ? node.children : [];
        if (node.type === "column" || node.type === "row") {
          const el = document.createElement("div");
          el.className = node.type === "column" ? "ui-column" : "ui-row";
          spacingStyle(el, props);
          sizeStyle(el, props);
          for (const child of children) el.appendChild(renderNode(child));
          return el;
        }
        if (node.type === "grid") {
          const el = document.createElement("div");
          el.className = "ui-grid";
          spacingStyle(el, props);
          sizeStyle(el, props);
          for (const child of children) el.appendChild(renderNode(child));
          return el;
        }
        if (node.type === "text") {
          const el = document.createElement("div");
          el.className = "ui-text";
          el.textContent = String(props.text || "");
          return el;
        }
        if (node.type === "divider") {
          const el = document.createElement("div");
          el.className = "ui-divider";
          return el;
        }
        if (node.type === "spacer") {
          const el = document.createElement("div");
          el.style.height = (typeof props.height === "number" ? props.height : 12) + "px";
          return el;
        }
        if (node.type === "button") {
          const el = document.createElement("button");
          el.textContent = String(props.label || props.title || "Button");
          el.onclick = () => sendUiEvent(String(props.id || node.id || ""), "tap", {});
          return el;
        }
        if (node.type === "tile") {
          const el = document.createElement("button");
          el.className = "ui-tile";
          spacingStyle(el, props);
          const title = document.createElement("div");
          title.className = "ui-tile-title";
          title.textContent = String(props.title || props.label || "");
          const value = document.createElement("div");
          value.className = "ui-tile-value";
          value.textContent = String(props.value ?? props.text ?? "");
          if (title.textContent) el.appendChild(title);
          el.appendChild(value);
          el.onclick = () => sendUiEvent(String(props.id || node.id || ""), "tap", {});
          return el;
        }
        if (node.type === "slider") {
          const el = document.createElement("input");
          el.className = "ui-control";
          el.type = "range";
          el.min = String(props.min ?? 0);
          el.max = String(props.max ?? 100);
          el.step = String(props.step ?? 1);
          el.value = String(props.value ?? 0);
          el.onchange = () => sendUiEvent(String(props.id || node.id || ""), "change", { value: Number(el.value) });
          return el;
        }
        if (node.type === "textField") {
          const wrap = document.createElement("div");
          wrap.className = "ui-field";
          spacingStyle(wrap, props);
          if (props.label) {
            const label = document.createElement("div");
            label.className = "ui-label";
            label.textContent = String(props.label);
            wrap.appendChild(label);
          }
          const el = document.createElement("input");
          el.className = "ui-input";
          el.type = "text";
          el.value = String(props.value ?? props.text ?? "");
          el.placeholder = String(props.placeholder || "");
          el.onchange = () => sendUiEvent(String(props.id || node.id || ""), "change", { value: el.value });
          el.onkeydown = (event) => {
            if (event.key === "Enter") sendUiEvent(String(props.id || node.id || ""), "submit", { value: el.value });
          };
          wrap.appendChild(el);
          return wrap;
        }
        if (node.type === "textEditor") {
          const wrap = document.createElement("div");
          wrap.className = "ui-field";
          spacingStyle(wrap, props);
          if (props.label) {
            const label = document.createElement("div");
            label.className = "ui-label";
            label.textContent = String(props.label);
            wrap.appendChild(label);
          }
          const el = document.createElement("textarea");
          el.className = "ui-input ui-editor";
          el.value = String(props.value ?? props.text ?? "");
          el.placeholder = String(props.placeholder || "");
          el.onchange = () => sendUiEvent(String(props.id || node.id || ""), "change", { value: el.value });
          el.onkeydown = (event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              sendUiEvent(String(props.id || node.id || ""), "submit", { value: el.value });
            }
          };
          wrap.appendChild(el);
          return wrap;
        }
        if (node.type === "picker") {
          const el = document.createElement("select");
          el.className = "ui-control";
          const opts = Array.isArray(props.options) ? props.options : [];
          for (const opt of opts) {
            const option = document.createElement("option");
            option.value = String(opt.value ?? opt.label ?? "");
            option.textContent = String(opt.label ?? opt.value ?? "");
            el.appendChild(option);
          }
          el.value = String(props.selected ?? "");
          el.onchange = () => sendUiEvent(String(props.id || node.id || ""), "change", { value: el.value });
          return el;
        }
        if (node.type === "scroll") {
          const el = document.createElement("div");
          el.className = "ui-scroll";
          spacingStyle(el, props);
          sizeStyle(el, props);
          for (const child of children) el.appendChild(renderNode(child));
          return el;
        }
        if (node.type === "card") {
          const el = document.createElement("div");
          el.className = "ui-card";
          spacingStyle(el, props);
          if (props.title || props.subtitle) {
            const head = document.createElement("div");
            if (props.title) {
              const title = document.createElement("div");
              title.className = "ui-card-title";
              title.textContent = String(props.title);
              head.appendChild(title);
            }
            if (props.subtitle) {
              const subtitle = document.createElement("div");
              subtitle.className = "ui-muted";
              subtitle.textContent = String(props.subtitle);
              head.appendChild(subtitle);
            }
            el.appendChild(head);
          }
          for (const child of children) el.appendChild(renderNode(child));
          return el;
        }
        if (node.type === "progress") {
          const el = document.createElement("div");
          el.className = "ui-progress";
          const max = finiteNumber(props.total ?? props.max, 100);
          const value = finiteNumber(props.value, 0);
          const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
          const track = document.createElement("div");
          track.className = "ui-progress-track";
          const fill = document.createElement("div");
          fill.className = "ui-progress-fill";
          fill.style.width = Math.round(pct * 100) + "%";
          track.appendChild(fill);
          const label = document.createElement("div");
          label.className = "ui-muted";
          label.textContent = Math.round(pct * 100) + "%";
          el.appendChild(track);
          el.appendChild(label);
          return el;
        }
        if (node.type === "logViewer") {
          const el = document.createElement("pre");
          el.className = "ui-log";
          el.textContent = String(props.text ?? props.value ?? "");
          return el;
        }
        if (node.type === "plot") {
          return renderPlotNode(node, props);
        }
        const fallback = document.createElement("div");
        fallback.className = "node";
        fallback.textContent = node.type || "node";
        for (const child of children) fallback.appendChild(renderNode(child));
        return fallback;
      }

      function renderSnapshot(root) {
        preview.innerHTML = "";
        preview.appendChild(renderNode(root));
      }

      let lastSnapshotRoot = null;

      function requestInitialPlotViewports(root) {
        const plots = [];
        collectPlotNodes(root, plots);
        for (const plot of plots) {
          const props = plot.props || {};
          const id = nodeId(plot, props.id || "plot");
          if (!id) continue;
          const min = finiteNumber(props.xMin ?? props.xDomainMin ?? props.xBoundsMin, 0);
          const max = finiteNumber(props.xMax ?? props.xDomainMax ?? props.xBoundsMax, min + 1);
          if (max <= min) continue;
          requestPlotViewport(id, { min, max }, finiteNumber(props.bins, 400));
        }
      }

      function renderDeviceStatus(msg) {
        const connected = Boolean(msg.connected);
        deviceStatusLabel.textContent = connected ? "online" : "offline";
        const devices = Array.isArray(msg.devices) ? msg.devices : [];
        if (!connected || devices.length === 0) {
          deviceStatusEl.innerHTML = '<div class="device-name">Waiting for EMWaver app</div><div class="device-meta">Start the native app on this machine to run scripts against hardware.</div>';
          return;
        }
        deviceStatusEl.innerHTML = "";
        for (const device of devices) {
          const card = document.createElement("div");
          card.className = "device-card";
          const name = document.createElement("div");
          name.className = "device-name";
          name.textContent = String(device.name || device.id || "EMWaver device");
          const meta = document.createElement("div");
          meta.className = "device-meta";
          meta.textContent = String(device.connected ? "connected" : "available") + " via " + String(msg.runtimeOwner || "native app");
          card.appendChild(name);
          card.appendChild(meta);
          deviceStatusEl.appendChild(card);
        }
      }

      function sendUiEvent(targetNodeId, name, payload) {
        if (!ws || ws.readyState !== WebSocket.OPEN || !scriptInstanceId) return;
        ws.send(JSON.stringify({ type: "ui.event", hostSessionId: "local", scriptInstanceId, baseRev: currentRev, targetNodeId, name, payload: payload || {} }));
      }

      ws.onopen = () => {
        setStatus("connected", "open");
        ws.send(JSON.stringify({ type: "hello", role: "web", protocolVersion: 1 }));
      };
      ws.onclose = () => setStatus("closed", "");
      ws.onerror = () => setStatus("error", "error");
      ws.onmessage = (event) => {
        const msg = JSON.parse(String(event.data || "{}"));
        appendLog(msg);
        if (msg.type === "device.status") {
          setStatus(msg.connected ? "native app connected" : "waiting for native app", msg.connected ? "open" : "");
          renderDeviceStatus(msg);
        }
        if (msg.type === "script.started") {
          scriptInstanceId = msg.scriptInstanceId || "";
          plotDataByNodeId = {};
          clearObject(plotViews);
          clearObject(plotDrags);
        }
        if (msg.type === "script.stopped") {
          scriptInstanceId = "";
          preview.innerHTML = '<div class="ui-muted">Script stopped.</div>';
        }
        if (msg.type === "ui.snapshot") {
          currentRev = Number(msg.rev || 0);
          rev.textContent = "rev " + currentRev;
          lastSnapshotRoot = msg.root;
          renderSnapshot(msg.root);
          requestInitialPlotViewports(msg.root);
        }
        if (msg.type === "plot.data") {
          const targetNodeId = String(msg.targetNodeId || "");
          if (targetNodeId) {
            plotDataByNodeId[targetNodeId] = msg;
            const min = finiteNumber(msg.xMin, NaN);
            const max = finiteNumber(msg.xMax, NaN);
            if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
              plotViews[targetNodeId] = { min, max };
            }
            renderSnapshot(lastSnapshotRoot);
          }
        }
        if (msg.type === "script.error" || msg.type === "host.error") {
          const el = document.createElement("div");
          el.className = msg.type === "host.error" ? "warning" : "error";
          el.textContent = String(msg.error || "error");
          preview.innerHTML = "";
          preview.appendChild(el);
        }
      };
      document.getElementById("run").onclick = () => {
        log.innerHTML = "";
        ws.send(JSON.stringify({ type: "script.run", name: selectedName, source: source.value }));
      };
      document.getElementById("open").onclick = () => {
        document.getElementById("openFile").click();
      };
      document.getElementById("openFile").onchange = async (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        selectedName = file.name || "script.emw";
        filename.textContent = selectedName;
        source.value = await file.text();
        event.target.value = "";
        for (const child of examplesEl.children) child.classList.remove("active");
      };
      document.getElementById("save").onclick = () => {
        const blob = new Blob([source.value], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = selectedName && selectedName.endsWith(".emw") ? selectedName : "script.emw";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      };
      document.getElementById("stop").onclick = () => {
        ws.send(JSON.stringify({ type: "script.stop", hostSessionId: "local", scriptInstanceId }));
      };
      document.getElementById("askAgent").onclick = async () => {
        agentOutput.textContent = "Asking...";
        try {
          const response = await fetch("/v1/agent", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mode: "debug",
              prompt: agentPrompt.value,
              script: { name: selectedName, source: source.value },
              runtime: {},
              hardware: { boardType: "unknown-local-app", modules: [] },
              context: { uiRev: currentRev }
            })
          });
          const body = await response.json();
          agentOutput.textContent = body.message || body.code || body.error || JSON.stringify(body, null, 2);
          if (body.code) source.value = body.code;
        } catch (error) {
          agentOutput.textContent = String(error && error.message ? error.message : error);
        }
      };
      loadExamples().finally(renderExamples);
    </script>
  </body>
</html>`;

const port = numberEnv("EMWAVER_GATEWAY_PORT", DEFAULT_PORT);
const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(indexHtml);
    return;
  }
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "emwaver-gateway", runtimeOwner: "native-app" }));
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
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not found");
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
        else apps.add(ws);
      }

      handleWsMessage(ws, role, message);
    });

    ws.on("close", () => {
      if (role === "web") webs.delete(ws);
      if (role === "host" || role === "app") {
        apps.delete(ws);
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
