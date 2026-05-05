import { useEffect, useMemo, useRef, useState } from "react";
import { EmwUiPreview } from "./EmwUiPreview";
import { RemoteEmwUi } from "./RemoteEmwUi";
import { evalEmwUi } from "./emwUiRuntime";
import {
  localGatewayWsUrl,
  type RemoteDeviceStatus,
  type RemoteIncomingMessage,
  type RemotePlotData,
  type RemoteUiNode,
  wsSend,
} from "./remoteSessions";

type ExampleScript = { name: string; source: string };
type WsStatus = "connecting" | "open" | "closed" | "error";

function isEmw(name: string | null) {
  return String(name || "").toLowerCase().endsWith(".emw");
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function statusLabel(status: WsStatus, deviceStatus: RemoteDeviceStatus | null) {
  if (status === "connecting") return "connecting";
  if (status === "error") return "connection error";
  if (status === "closed") return "closed";
  return deviceStatus?.connected ? "native app connected" : "waiting for native app";
}

export function GatewayApp() {
  const [examples, setExamples] = useState<ExampleScript[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [mode, setMode] = useState<"editor" | "preview">("editor");
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  const [deviceStatus, setDeviceStatus] = useState<RemoteDeviceStatus | null>(null);
  const [scriptInstanceId, setScriptInstanceId] = useState("");
  const [uiRev, setUiRev] = useState(0);
  const [remoteUiRoot, setRemoteUiRoot] = useState<RemoteUiNode | null>(null);
  const [plotDataByNodeId, setPlotDataByNodeId] = useState<Record<string, RemotePlotData>>({});
  const [uiError, setUiError] = useState<string | null>(null);
  const [log, setLog] = useState<RemoteIncomingMessage[]>([]);
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentOutput, setAgentOutput] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const openFileRef = useRef<HTMLInputElement | null>(null);

  const previewResult = useMemo(() => {
    if (!selected || !isEmw(selected) || mode !== "preview" || remoteUiRoot) return null;
    return evalEmwUi(source);
  }, [mode, remoteUiRoot, selected, source]);

  useEffect(() => {
    let cancelled = false;
    fetch("/v1/examples")
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return;
        const loaded = Array.isArray(body.examples) ? body.examples : [];
        setExamples(loaded);
        if (loaded.length > 0) {
          setSelected(loaded[0].name);
          setSource(loaded[0].source);
        }
      })
      .catch((error) => setUiError(formatError(error)));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const ws = new WebSocket(localGatewayWsUrl());
    wsRef.current = ws;
    setWsStatus("connecting");

    ws.onopen = () => {
      setWsStatus("open");
      wsSend(ws, { type: "hello", role: "web", protocolVersion: 1 });
    };
    ws.onclose = () => setWsStatus("closed");
    ws.onerror = () => setWsStatus("error");
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data || "{}")) as RemoteIncomingMessage;
      setLog((items) => [msg, ...items].slice(0, 24));

      if (msg.type === "device.status") setDeviceStatus(msg as RemoteDeviceStatus);
      if (msg.type === "script.started") {
        setScriptInstanceId(String(msg.scriptInstanceId || ""));
        setRemoteUiRoot(null);
        setPlotDataByNodeId({});
        setMode("preview");
        setUiError(null);
      }
      if (msg.type === "script.stopped") {
        setScriptInstanceId("");
        setRemoteUiRoot(null);
      }
      if (msg.type === "ui.snapshot") {
        setUiRev(Number(msg.rev || 0));
        setScriptInstanceId(String(msg.scriptInstanceId || ""));
        setRemoteUiRoot((msg.root as RemoteUiNode | null) || null);
        setMode("preview");
      }
      if (msg.type === "plot.data") {
        const plot = msg as RemotePlotData;
        if (plot.targetNodeId) {
          setPlotDataByNodeId((items) => ({ ...items, [plot.targetNodeId]: plot }));
        }
      }
      if (msg.type === "script.error" || msg.type === "host.error") {
        setUiError(String(msg.error || "error"));
      }
    };

    return () => {
      wsRef.current = null;
      ws.close();
    };
  }, []);

  function openExample(example: ExampleScript) {
    setSelected(example.name);
    setSource(example.source);
    setMode("editor");
    setRemoteUiRoot(null);
    setUiError(null);
  }

  function runScript() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setUiError("Gateway WebSocket is not connected.");
      return;
    }
    setLog([]);
    setUiError(null);
    wsSend(ws, { type: "script.run", name: selected || "script.emw", source });
  }

  function stopScript() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    wsSend(ws, { type: "script.stop", hostSessionId: "local", scriptInstanceId });
  }

  async function openLocalFile(file: File) {
    setSelected(file.name || "script.emw");
    setSource(await file.text());
    setMode("editor");
    setRemoteUiRoot(null);
    setUiError(null);
  }

  function saveLocalFile() {
    const blob = new Blob([source], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = selected && selected.endsWith(".emw") ? selected : "script.emw";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function askAgent() {
    setAgentOutput("Asking...");
    try {
      const response = await fetch("/v1/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "debug",
          prompt: agentPrompt,
          script: { name: selected || "script.emw", source },
          runtime: { uiRev, scriptInstanceId },
          hardware: { boardType: "unknown-local-app", modules: [] },
        }),
      });
      const body = await response.json();
      setAgentOutput(body.message || body.code || body.error || JSON.stringify(body, null, 2));
      if (body.code) {
        setSource(String(body.code));
        setMode("editor");
      }
    } catch (error) {
      setAgentOutput(formatError(error));
    }
  }

  const canPreview = selected && isEmw(selected);
  const connected = !!deviceStatus?.connected;

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Local-first control</div>
          <h1>EMWaver Gateway</h1>
        </div>
        <div className="status-pill" data-state={connected ? "online" : "offline"}>
          <span />
          {statusLabel(wsStatus, deviceStatus)}
        </div>
      </header>

      <main className="dashboard">
        <aside className="sidebar">
          <div className="panel-title">Example Scripts</div>
          <div className="script-list">
            {examples.map((example) => (
              <button
                key={example.name}
                type="button"
                className={selected === example.name ? "script-row active" : "script-row"}
                onClick={() => openExample(example)}
              >
                <strong>{example.name}</strong>
                <span>Bundled example</span>
              </button>
            ))}
          </div>

          <div className="device-panel">
            <div className="panel-title">Native App</div>
            {connected && deviceStatus?.devices?.length ? (
              deviceStatus.devices.map((device) => (
                <div className="device-card" key={device.id || device.name}>
                  <strong>{device.name || device.id || "EMWaver native app"}</strong>
                  <span>{device.connected ? "connected" : "available"} via {deviceStatus.runtimeOwner || "native app"}</span>
                </div>
              ))
            ) : (
              <div className="device-card">
                <strong>Waiting for EMWaver app</strong>
                <span>Start the native app on this machine to run scripts against hardware.</span>
              </div>
            )}
          </div>

          <div className="local-files">
            <button type="button" onClick={() => openFileRef.current?.click()}>Open</button>
            <button type="button" onClick={saveLocalFile}>Save</button>
            <input
              id="openFile"
              ref={openFileRef}
              type="file"
              accept=".emw,.txt,.raw"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void openLocalFile(file);
                event.currentTarget.value = "";
              }}
            />
          </div>
        </aside>

        <section className="workspace">
          <div className="workspace-header">
            <div>
              <div className="filename">{selected || "Viewer"}</div>
              <div className="subtle">No cloud relay required. Scripts stay local by default.</div>
            </div>
            <div className="actions">
              {canPreview ? (
                <div className="segmented">
                  <button type="button" className={mode === "editor" ? "active" : ""} onClick={() => setMode("editor")}>Editor</button>
                  <button type="button" className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}>Preview</button>
                </div>
              ) : null}
              <button type="button" onClick={runScript}>Run</button>
              <button type="button" className="danger" onClick={stopScript} disabled={!scriptInstanceId}>Stop</button>
            </div>
          </div>

          {uiError ? <div className="error">{uiError}</div> : null}

          {canPreview && mode === "preview" ? (
            <div className="preview-surface">
              {remoteUiRoot ? (
                <>
                  <RemoteEmwUi
                    root={remoteUiRoot}
                    plotDataByNodeId={plotDataByNodeId}
                    onEvent={(targetId, name, payload) => {
                      const ws = wsRef.current;
                      if (!ws || ws.readyState !== WebSocket.OPEN || !scriptInstanceId) return;
                      if (name === "viewport") {
                        wsSend(ws, {
                          type: "plot.viewport",
                          hostSessionId: "local",
                          scriptInstanceId,
                          baseRev: uiRev,
                          targetNodeId: targetId,
                          payload: payload || {},
                        });
                        return;
                      }
                      wsSend(ws, {
                        type: "ui.event",
                        hostSessionId: "local",
                        scriptInstanceId,
                        baseRev: uiRev,
                        targetNodeId: targetId,
                        name,
                        payload: payload || {},
                      });
                    }}
                  />
                  <div className="subtle footer-note">Live mode: UI and interactions are running on the native app.</div>
                </>
              ) : previewResult?.error ? (
                <div className="error">{previewResult.error}</div>
              ) : previewResult?.root ? (
                <>
                  <EmwUiPreview root={previewResult.root} />
                  <div className="subtle footer-note">Preview mode: controls are disabled and device APIs are stubbed.</div>
                </>
              ) : (
                <div className="empty">No UI.render(...) found.</div>
              )}
            </div>
          ) : (
            <textarea
              value={source}
              onChange={(event) => {
                setSource(event.target.value);
                setUiError(null);
              }}
              spellCheck={false}
            />
          )}
        </section>

        <aside className="agent-panel">
          <div className="panel-title">Ask Agent</div>
          <textarea
            className="agent-input"
            value={agentPrompt}
            onChange={(event) => setAgentPrompt(event.target.value)}
            placeholder="Ask for a script edit or debugging pass."
          />
          <button type="button" onClick={askAgent}>Ask Agent</button>
          <pre>{agentOutput || "Optional Agent API key required."}</pre>

          <div className="panel-title log-title">Gateway Log</div>
          <div className="log">
            {log.map((item, index) => (
              <code key={index}>{String(item.type)}</code>
            ))}
          </div>
        </aside>
      </main>
    </div>
  );
}
