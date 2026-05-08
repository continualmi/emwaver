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
type ActivityId = "library" | "runtime" | "agent" | "log";

function isEmw(name: string | null) {
  return String(name || "").toLowerCase().endsWith(".emw");
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function statusLabel(status: WsStatus, deviceStatus: RemoteDeviceStatus | null) {
  if (status === "connecting") return "connecting";
  if (status === "error") return "connection error";
  if (status === "closed") return "gateway closed";
  if (!deviceStatus?.connected) return "waiting for runtime";
  if (deviceStatus.runtimeOwner === "native-app") return "native app connected";
  if (deviceStatus.runtimeOwner === "emwaver-daemon") return "daemon connected";
  return "runtime connected";
}

function statusTone(status: WsStatus, deviceStatus: RemoteDeviceStatus | null): "online" | "warn" | "offline" {
  if (status === "error" || status === "closed") return "offline";
  if (status === "connecting") return "warn";
  if (!deviceStatus?.connected) return "warn";
  return "online";
}

function runtimeLabel(runtimeOwner?: string) {
  if (runtimeOwner === "native-app") return "Native App";
  if (runtimeOwner === "emwaver-daemon") return "Daemon";
  return "Local Runtime";
}

function deviceDetail(device: NonNullable<RemoteDeviceStatus["devices"]>[number], runtimeOwner?: string) {
  const parts = [
    device.connected ? "connected" : "available",
    device.transport,
    device.boardType,
    device.endpoint,
    runtimeLabel(runtimeOwner),
  ].filter(Boolean);
  return parts.join(" · ");
}

function summarizeUiNode(node: RemoteUiNode | null, depth = 0): unknown {
  if (!node || depth > 3) return null;
  return {
    id: node.id,
    type: node.type,
    props: node.props || {},
    handlers: node.handlers ? Object.keys(node.handlers) : [],
    children: (node.children || []).slice(0, 8).map((child) => summarizeUiNode(child, depth + 1)),
  };
}

function timeOfDay(d = new Date()) {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

type LogEntry = { type: string; at: string; raw: RemoteIncomingMessage };
type LiveSession = { id: string; name: string; deviceId: string; root: RemoteUiNode | null; rev: number; plotDataByNodeId: Record<string, RemotePlotData> };

export function GatewayApp() {
  const [examples, setExamples] = useState<ExampleScript[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [mode, setMode] = useState<"editor" | "preview">("editor");
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  const [deviceStatus, setDeviceStatus] = useState<RemoteDeviceStatus | null>(null);
  const [scriptInstanceId, setScriptInstanceId] = useState("");
  const [sessions, setSessions] = useState<Record<string, LiveSession>>({});
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [uiRev, setUiRev] = useState(0);
  const [remoteUiRoot, setRemoteUiRoot] = useState<RemoteUiNode | null>(null);
  const [plotDataByNodeId, setPlotDataByNodeId] = useState<Record<string, RemotePlotData>>({});
  const [uiError, setUiError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentOutput, setAgentOutput] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [daemonAction, setDaemonAction] = useState("");
  const [daemonBusy, setDaemonBusy] = useState(false);
  const [daemonWifiHost, setDaemonWifiHost] = useState("");
  const [daemonWifiSecret, setDaemonWifiSecret] = useState("");
  const [daemonWifiPort, setDaemonWifiPort] = useState("3922");
  const [activity, setActivity] = useState<ActivityId | null>("library");
  const [unreadAgent, setUnreadAgent] = useState(false);
  const [unreadLog, setUnreadLog] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const activeSessionRef = useRef("");
  const openFileRef = useRef<HTMLInputElement | null>(null);
  const activityRef = useRef<ActivityId | null>("library");

  useEffect(() => {
    activeSessionRef.current = scriptInstanceId;
  }, [scriptInstanceId]);

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
      const entry: LogEntry = { type: String(msg.type), at: timeOfDay(), raw: msg };
      setLog((items) => [entry, ...items].slice(0, 80));
      setUnreadLog((n) => (activityRef.current === "log" ? 0 : Math.min(n + 1, 99)));

      if (msg.type === "device.status") {
        const status = msg as RemoteDeviceStatus;
        setDeviceStatus(status);
        setSelectedDeviceId((current) => current || status.devices?.find((d) => d.connected)?.id || status.devices?.[0]?.id || "");
      }
      if (msg.type === "script.started") {
        const id = String(msg.scriptInstanceId || "");
        const deviceId = String(msg.deviceId || selectedDeviceId || "");
        setScriptInstanceId(id);
        setSessions((items) => ({ ...items, [id]: { id, name: String(msg.name || selected || "script.emw"), deviceId, root: null, rev: 0, plotDataByNodeId: {} } }));
        setRemoteUiRoot(null);
        setPlotDataByNodeId({});
        setMode("preview");
        setUiError(null);
      }
      if (msg.type === "script.stopped") {
        const stoppedId = String(msg.scriptInstanceId || "");
        setSessions((items) => {
          const next = { ...items };
          delete next[stoppedId];
          return next;
        });
        if (stoppedId === scriptInstanceId) {
          setScriptInstanceId("");
          setRemoteUiRoot(null);
        }
      }
      if (msg.type === "ui.snapshot") {
        const id = String(msg.scriptInstanceId || "");
        const root = (msg.root as RemoteUiNode | null) || null;
        const rev = Number(msg.rev || 0);
        setSessions((items) => ({
          ...items,
          [id]: { ...(items[id] || { id, name: "script.emw", deviceId: String(msg.deviceId || ""), plotDataByNodeId: {} }), root, rev },
        }));
        if (!activeSessionRef.current || activeSessionRef.current === id) {
          setUiRev(rev);
          setScriptInstanceId(id);
          setRemoteUiRoot(root);
        }
        setMode("preview");
      }
      if (msg.type === "plot.data") {
        const plot = msg as RemotePlotData;
        if (plot.targetNodeId) {
          setPlotDataByNodeId((items) => ({ ...items, [plot.targetNodeId]: plot }));
          setSessions((items) => {
            const id = String(plot.scriptInstanceId || "");
            const session = items[id];
            if (!session) return items;
            return { ...items, [id]: { ...session, plotDataByNodeId: { ...session.plotDataByNodeId, [plot.targetNodeId]: plot } } };
          });
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

  function selectActivity(next: ActivityId) {
    setActivity((current) => {
      const resolved = current === next ? null : next;
      activityRef.current = resolved;
      return resolved;
    });
    if (next === "agent") setUnreadAgent(false);
    if (next === "log") setUnreadLog(0);
  }

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
    setUnreadLog(0);
    setUiError(null);
    wsSend(ws, { type: "script.run", name: selected || "script.emw", source, deviceId: selectedDeviceId || undefined });
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
    if (!agentPrompt.trim() || agentBusy) return;
    setAgentBusy(true);
    setAgentOutput("Asking…");
    try {
      const runtimeOwner = runtimeLabel(deviceStatus?.runtimeOwner);
      const userInput = [
        agentPrompt,
        "",
        "Local EMWaver context:",
        JSON.stringify(
          {
            script: { name: selected || "script.emw", source },
            runtime: {
              owner: deviceStatus?.runtimeOwner || "none",
              label: runtimeOwner,
              connected,
              uiRev,
              scriptInstanceId: scriptInstanceId || null,
              uiSnapshot: summarizeUiNode(remoteUiRoot),
            },
            hardware: {
              runtimeOwner: deviceStatus?.runtimeOwner || "none",
              devices: deviceStatus?.devices || [],
            },
          },
          null,
          2,
        ),
      ].join("\n");
      const response = await fetch("/v1/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userInput }),
      });
      const body = await response.json();
      const text = body.message || body.code || body.error || JSON.stringify(body, null, 2);
      setAgentOutput(text);
      if (body.code) {
        setSource(String(body.code));
        setMode("editor");
      }
      if (activity !== "agent") setUnreadAgent(true);
    } catch (error) {
      setAgentOutput(formatError(error));
    } finally {
      setAgentBusy(false);
    }
  }

  async function startDaemon(options?: { wifi?: string; wifiSecret?: string; wifiPort?: string }) {
    if (daemonBusy) return;
    setDaemonBusy(true);
    setDaemonAction(options?.wifi ? "Starting Wi-Fi daemon…" : "Starting daemon…");
    setUiError(null);
    try {
      const payload = options?.wifi
        ? { wifi: options.wifi, wifiSecret: options.wifiSecret || "", wifiPort: options.wifiPort || "3922" }
        : {};
      const response = await fetch("/v1/daemon/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok || body?.ok === false) {
        throw new Error(body?.message || body?.error || "daemon_start_failed");
      }
      setDaemonAction(body?.alreadyRunning ? "Runtime already connected." : "Daemon start requested.");
    } catch (error) {
      const message = formatError(error);
      setDaemonAction(message);
      setUiError(message);
    } finally {
      setDaemonBusy(false);
    }
  }

  const canPreview = !!(selected && isEmw(selected));
  const connected = !!deviceStatus?.connected;
  const tone = statusTone(wsStatus, deviceStatus);
  const liveScript = !!scriptInstanceId;
  const liveSessions = Object.values(sessions);

  function selectLiveSession(id: string) {
    const session = sessions[id];
    if (!session) return;
    setScriptInstanceId(id);
    setRemoteUiRoot(session.root);
    setUiRev(session.rev);
    setPlotDataByNodeId(session.plotDataByNodeId);
    setMode("preview");
  }

  return (
    <div className="flex h-dvh min-h-dvh flex-col overflow-hidden">
      <BrandHeader status={statusLabel(wsStatus, deviceStatus)} tone={tone} />

      <div className="flex min-h-0 flex-1">
        <ActivityRail
          active={activity}
          onSelect={selectActivity}
          unreadAgent={unreadAgent}
          unreadLog={unreadLog}
          runtimeOnline={connected}
          runtimeWarn={tone !== "online"}
        />

        <SidePanel
          activity={activity}
          examples={examples}
          selected={selected}
          openExample={openExample}
          openLocal={() => openFileRef.current?.click()}
          saveLocal={saveLocalFile}
          deviceStatus={deviceStatus}
          connected={connected}
          startDaemon={startDaemon}
          daemonBusy={daemonBusy}
          daemonAction={daemonAction}
          daemonWifiHost={daemonWifiHost}
          setDaemonWifiHost={setDaemonWifiHost}
          daemonWifiSecret={daemonWifiSecret}
          setDaemonWifiSecret={setDaemonWifiSecret}
          daemonWifiPort={daemonWifiPort}
          setDaemonWifiPort={setDaemonWifiPort}
          agentPrompt={agentPrompt}
          setAgentPrompt={setAgentPrompt}
          agentOutput={agentOutput}
          agentBusy={agentBusy}
          onAsk={askAgent}
          log={log}
          onClearLog={() => {
            setLog([]);
            setUnreadLog(0);
          }}
        />

        <input
          ref={openFileRef}
          type="file"
          accept=".emw,.txt,.raw"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void openLocalFile(file);
            event.currentTarget.value = "";
          }}
        />

        <Workspace
          filename={selected || "Untitled"}
          subtitle={
            connected
              ? `Local runtime connected — choose a device, run a script, and switch between running sessions below.`
              : "Local-first. No cloud relay required."
          }
          canPreview={canPreview}
          mode={mode}
          setMode={setMode}
          onRun={runScript}
          onStop={stopScript}
          canStop={liveScript}
          devices={deviceStatus?.devices || []}
          selectedDeviceId={selectedDeviceId}
          setSelectedDeviceId={setSelectedDeviceId}
          sessions={liveSessions}
          activeSessionId={scriptInstanceId}
          onSelectSession={selectLiveSession}
          uiError={uiError}
          source={source}
          onSourceChange={(value) => {
            setSource(value);
            setUiError(null);
          }}
          remoteUiRoot={remoteUiRoot}
          plotDataByNodeId={plotDataByNodeId}
          previewResult={previewResult}
          runtimeOwnerLabel={runtimeLabel(deviceStatus?.runtimeOwner)}
          liveScript={liveScript}
          onRemoteEvent={(targetId, name, payload) => {
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
      </div>
    </div>
  );
}

/* ─────────────────────────── Header ─────────────────────────── */

function BrandHeader({ status, tone }: { status: string; tone: "online" | "warn" | "offline" }) {
  const dotClass =
    tone === "online"
      ? "bg-[color:var(--aqua)] shadow-[0_0_10px_var(--aqua-tint-2)]"
      : tone === "warn"
      ? "bg-[color:var(--copper)]"
      : "bg-[color:var(--danger)]";
  const pillClass =
    tone === "online"
      ? "border-[color:var(--aqua-tint-2)] bg-[color:var(--aqua-tint)] text-[color:var(--aqua)]"
      : tone === "warn"
      ? "border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink-dim)]"
      : "border-[color:var(--danger-tint-2)] bg-[color:var(--danger-tint)] text-[color:var(--danger)]";

  return (
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[color:var(--line)] bg-[color:var(--glass)] px-5 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 overflow-hidden rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] p-1">
            <img src="/continual-logo.png" alt="Continual MI" className="h-full w-full object-contain" />
          </div>
          <div className="h-9 w-9 overflow-hidden rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)]">
            <img src="/logo.png" alt="EMWaver" className="h-full w-full object-cover" />
          </div>
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight text-[color:var(--ink)]">
            EMWaver Gateway
          </div>
          <div className="text-[12px] text-[color:var(--ink-dim)]">
            Local-first hardware control
          </div>
        </div>
      </div>

      <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold ${pillClass}`}>
        <span className={`h-2 w-2 rounded-full ${dotClass}`} aria-hidden />
        {status}
      </div>
    </header>
  );
}

/* ─────────────────────────── Activity rail ─────────────────────────── */

function ActivityRail(props: {
  active: ActivityId | null;
  onSelect: (id: ActivityId) => void;
  unreadAgent: boolean;
  unreadLog: number;
  runtimeOnline: boolean;
  runtimeWarn: boolean;
}) {
  const { active, onSelect, unreadAgent, unreadLog, runtimeOnline, runtimeWarn } = props;
  return (
    <nav
      aria-label="Gateway sections"
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-[color:var(--line)] bg-[color:var(--glass-heavy)] py-3"
    >
      <RailButton
        id="library"
        active={active === "library"}
        label="Library"
        onClick={() => onSelect("library")}
        icon={<LibraryIcon />}
      />
      <RailButton
        id="runtime"
        active={active === "runtime"}
        label="Runtime"
        onClick={() => onSelect("runtime")}
        icon={<RuntimeIcon />}
        dot={runtimeOnline ? "online" : runtimeWarn ? "warn" : null}
      />
      <RailButton
        id="agent"
        active={active === "agent"}
        label="Agent"
        onClick={() => onSelect("agent")}
        icon={<AgentIcon />}
        dot={unreadAgent ? "info" : null}
      />
      <RailButton
        id="log"
        active={active === "log"}
        label="Log"
        onClick={() => onSelect("log")}
        icon={<LogIcon />}
        badge={unreadLog > 0 ? (unreadLog > 99 ? "99+" : String(unreadLog)) : null}
      />
    </nav>
  );
}

function RailButton(props: {
  id: ActivityId;
  active: boolean;
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  dot?: "online" | "warn" | "info" | null;
  badge?: string | null;
}) {
  const { active, label, onClick, icon, dot, badge } = props;
  const dotClass =
    dot === "online"
      ? "bg-[color:var(--aqua)]"
      : dot === "warn"
      ? "bg-[color:var(--copper)]"
      : dot === "info"
      ? "bg-[color:var(--sky)]"
      : "";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={
        "group relative flex h-11 w-11 items-center justify-center rounded-xl transition " +
        (active
          ? "bg-[color:var(--surface-2)] text-[color:var(--ink)] ring-1 ring-[color:var(--line-strong)]"
          : "text-[color:var(--ink-mute)] hover:bg-[color:var(--surface)] hover:text-[color:var(--ink)]")
      }
    >
      {active ? (
        <span className="absolute left-0 top-1/2 h-6 w-[2px] -translate-y-1/2 rounded-full bg-[color:var(--aqua)]" aria-hidden />
      ) : null}
      <span className="h-5 w-5">{icon}</span>
      {dot ? (
        <span className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden />
      ) : null}
      {badge ? (
        <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full border border-[color:var(--line)] bg-[color:var(--surface-2)] px-1 text-[10px] font-semibold text-[color:var(--ink)]">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

/* ─────────────────────────── Side panel ─────────────────────────── */

function SidePanel(props: {
  activity: ActivityId | null;
  examples: ExampleScript[];
  selected: string | null;
  openExample: (e: ExampleScript) => void;
  openLocal: () => void;
  saveLocal: () => void;
  deviceStatus: RemoteDeviceStatus | null;
  connected: boolean;
  startDaemon: (options?: { wifi?: string; wifiSecret?: string; wifiPort?: string }) => void;
  daemonBusy: boolean;
  daemonAction: string;
  daemonWifiHost: string;
  setDaemonWifiHost: (v: string) => void;
  daemonWifiSecret: string;
  setDaemonWifiSecret: (v: string) => void;
  daemonWifiPort: string;
  setDaemonWifiPort: (v: string) => void;
  agentPrompt: string;
  setAgentPrompt: (v: string) => void;
  agentOutput: string;
  agentBusy: boolean;
  onAsk: () => void;
  log: LogEntry[];
  onClearLog: () => void;
}) {
  const { activity } = props;
  if (!activity) return null;

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-r border-[color:var(--line)] bg-[color:var(--surface-3)]">
      <header className="flex shrink-0 items-center justify-between border-b border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-mute)]">
            Section
          </div>
          <div className="text-[14px] font-semibold text-[color:var(--ink)]">{titleFor(activity)}</div>
        </div>
        {activity === "log" && props.log.length > 0 ? (
          <button
            type="button"
            onClick={props.onClearLog}
            className="rounded-md border border-[color:var(--line)] bg-[color:var(--surface-2)] px-2 py-1 text-[11px] font-semibold text-[color:var(--ink-dim)] hover:text-[color:var(--ink)]"
          >
            Clear
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {activity === "library" ? <LibraryPanel {...props} /> : null}
        {activity === "runtime" ? <RuntimePanel {...props} /> : null}
        {activity === "agent" ? <AgentPanel {...props} /> : null}
        {activity === "log" ? <LogPanel log={props.log} /> : null}
      </div>
    </aside>
  );
}

function titleFor(id: ActivityId): string {
  if (id === "library") return "Library";
  if (id === "runtime") return "Runtime";
  if (id === "agent") return "Agent";
  return "Log";
}

function LibraryPanel(props: {
  examples: ExampleScript[];
  selected: string | null;
  openExample: (e: ExampleScript) => void;
  openLocal: () => void;
  saveLocal: () => void;
}) {
  const { examples, selected, openExample, openLocal, saveLocal } = props;
  return (
    <div className="flex flex-col">
      <div className="border-b border-[color:var(--line)] px-4 py-3">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--aqua)]">
          Examples
        </div>
        <div className="text-[11px] leading-5 text-[color:var(--ink-dim)]">
          Bundled scripts ship with the gateway. Pick one to load it into the editor.
        </div>
      </div>

      {examples.length === 0 ? (
        <div className="px-4 py-6 text-[12px] text-[color:var(--ink-dim)]">No bundled examples.</div>
      ) : (
        <ul className="divide-y divide-[color:var(--line)]">
          {examples.map((example) => {
            const active = selected === example.name;
            return (
              <li key={example.name}>
                <button
                  type="button"
                  onClick={() => openExample(example)}
                  className={
                    "group flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition " +
                    (active
                      ? "bg-[color:var(--aqua-tint-2)]"
                      : "hover:bg-[color:var(--surface-2)]")
                  }
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[12px] font-semibold text-[color:var(--ink)]">
                      {example.name}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[color:var(--ink-dim)]">
                      Bundled example
                    </div>
                  </div>
                  <span
                    className={
                      "mt-0.5 shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] " +
                      (active ? "text-[color:var(--aqua)]" : "text-[color:var(--ink-mute)] group-hover:text-[color:var(--ink-dim)]")
                    }
                  >
                    {active ? "open" : "load"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-auto border-t border-[color:var(--line)] px-4 py-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--copper)]">
          Local files
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={openLocal}
            className="inline-flex h-9 items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-3 text-[12px] font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface)]"
          >
            Open…
          </button>
          <button
            type="button"
            onClick={saveLocal}
            className="inline-flex h-9 items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-3 text-[12px] font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface)]"
          >
            Save
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-[color:var(--ink-dim)]">
          Files stay on your device — browser-local open/save only.
        </p>
      </div>
    </div>
  );
}

function RuntimePanel(props: {
  deviceStatus: RemoteDeviceStatus | null;
  connected: boolean;
  startDaemon: (options?: { wifi?: string; wifiSecret?: string; wifiPort?: string }) => void;
  daemonBusy: boolean;
  daemonAction: string;
  daemonWifiHost: string;
  setDaemonWifiHost: (v: string) => void;
  daemonWifiSecret: string;
  setDaemonWifiSecret: (v: string) => void;
  daemonWifiPort: string;
  setDaemonWifiPort: (v: string) => void;
}) {
  const {
    deviceStatus,
    connected,
    startDaemon,
    daemonBusy,
    daemonAction,
    daemonWifiHost,
    setDaemonWifiHost,
    daemonWifiSecret,
    setDaemonWifiSecret,
    daemonWifiPort,
    setDaemonWifiPort,
  } = props;
  const canStartWifi = daemonWifiHost.trim() && daemonWifiSecret.trim() && !connected && !daemonBusy;
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-mute)]">
          Owner
        </div>
        <div className="mt-1 text-[14px] font-semibold text-[color:var(--ink)]">
          {connected ? runtimeLabel(deviceStatus?.runtimeOwner) : "No runtime"}
        </div>
        <div className="mt-1 text-[11px] leading-5 text-[color:var(--ink-dim)]">
          {connected
            ? "A runtime is connected to the gateway and ready to run scripts."
            : "Start the local daemon, or open the native EMWaver app on this machine."}
        </div>
      </div>

      <div>
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--sky)]">
          Devices
        </div>
        {connected && deviceStatus?.devices?.length ? (
          <ul className="space-y-2">
            {deviceStatus.devices.map((device) => (
              <li
                key={device.id || device.name}
                className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-3 py-2"
              >
                <div className="text-[13px] font-semibold text-[color:var(--ink)]">
                  {device.name || device.id || runtimeLabel(deviceStatus.runtimeOwner)}
                </div>
                <div className="text-[11px] text-[color:var(--ink-dim)]">
                  {deviceDetail(device, deviceStatus.runtimeOwner)}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed border-[color:var(--line)] bg-[color:var(--surface-3)] px-3 py-3 text-[12px] text-[color:var(--ink-dim)]">
            No devices reported.
          </div>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={() => startDaemon()}
          disabled={connected || daemonBusy}
          className="inline-flex h-9 w-full items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-3 text-[13px] font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {daemonBusy ? "Starting…" : connected ? "Runtime active" : "Start daemon"}
        </button>
        <p className="mt-2 text-[11px] leading-5 text-[color:var(--ink-dim)]">
          {daemonAction || "Falls back to the CLI runtime when no native app is connected."}
        </p>
      </div>

      <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] p-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--sky)]">
          Wi-Fi
        </div>
        <div className="mt-3 grid grid-cols-[1fr_72px] gap-2">
          <input
            value={daemonWifiHost}
            onChange={(event) => setDaemonWifiHost(event.target.value)}
            placeholder="Host or IP"
            disabled={connected || daemonBusy}
            className="h-9 rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-3)] px-3 text-[13px] text-[color:var(--ink)] outline-none focus:border-[color:var(--sky)] disabled:opacity-50"
          />
          <input
            value={daemonWifiPort}
            onChange={(event) => setDaemonWifiPort(event.target.value)}
            placeholder="3922"
            disabled={connected || daemonBusy}
            className="h-9 rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-3)] px-2 text-[13px] text-[color:var(--ink)] outline-none focus:border-[color:var(--sky)] disabled:opacity-50"
          />
        </div>
        <input
          value={daemonWifiSecret}
          onChange={(event) => setDaemonWifiSecret(event.target.value)}
          placeholder="Pairing secret"
          type="password"
          disabled={connected || daemonBusy}
          className="mt-2 h-9 w-full rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-3)] px-3 text-[13px] text-[color:var(--ink)] outline-none focus:border-[color:var(--sky)] disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() =>
            startDaemon({
              wifi: daemonWifiHost.trim(),
              wifiSecret: daemonWifiSecret.trim(),
              wifiPort: daemonWifiPort.trim() || "3922",
            })
          }
          disabled={!canStartWifi}
          className="mt-2 inline-flex h-9 w-full items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-3)] px-3 text-[13px] font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Start Wi-Fi daemon
        </button>
        <p className="mt-2 text-[11px] leading-5 text-[color:var(--ink-dim)]">
          Manual IP works when mDNS does not cross a LAN or user-owned VPN.
        </p>
      </div>
    </div>
  );
}

function AgentPanel(props: {
  agentPrompt: string;
  setAgentPrompt: (v: string) => void;
  agentOutput: string;
  agentBusy: boolean;
  onAsk: () => void;
}) {
  const { agentPrompt, setAgentPrompt, agentOutput, agentBusy, onAsk } = props;
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[color:var(--line)] px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--sky)]">
          Prompt
        </div>
        <textarea
          value={agentPrompt}
          onChange={(event) => setAgentPrompt(event.target.value)}
          placeholder="Ask for a script edit, an explanation, or a debugging pass…"
          className="mt-2 h-28 w-full resize-y rounded-xl border border-[color:var(--line)] bg-[color:var(--image-well)] p-3 text-[12px] leading-5 text-[color:var(--ink)] outline-none focus:border-[color:var(--sky-tint-2)] focus:ring-2 focus:ring-[color:var(--sky-tint)]"
        />
        <button
          type="button"
          onClick={onAsk}
          disabled={agentBusy || !agentPrompt.trim()}
          className="mt-2 inline-flex h-9 w-full items-center justify-center rounded-xl border border-[color:var(--sky-tint-2)] bg-[color:var(--sky-tint)] px-3 text-[13px] font-semibold text-[color:var(--sky)] transition hover:bg-[color:var(--sky-tint-2)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {agentBusy ? "Asking…" : "Ask agent"}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-4">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-mute)]">
          Response
        </div>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-xl border border-[color:var(--line)] bg-[color:var(--image-well)] p-3 font-mono text-[11px] leading-5 text-[color:var(--ink)]">
          {agentOutput || "Optional Agent API key required. Local hardware control still works without it."}
        </pre>
      </div>
    </div>
  );
}

function LogPanel({ log }: { log: LogEntry[] }) {
  if (log.length === 0) {
    return (
      <div className="p-4 text-[12px] text-[color:var(--ink-dim)]">
        Messages from the local runtime will appear here as they arrive.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-[color:var(--line)]">
      {log.map((entry, index) => (
        <li key={index} className="flex items-center gap-3 px-4 py-2">
          <span className="font-mono text-[10px] text-[color:var(--ink-mute)]">{entry.at}</span>
          <code className="flex-1 truncate font-mono text-[11px] text-[color:var(--ink)]">
            {entry.type}
          </code>
        </li>
      ))}
    </ul>
  );
}

/* ─────────────────────────── Workspace ─────────────────────────── */

function Workspace(props: {
  filename: string;
  subtitle: string;
  canPreview: boolean;
  mode: "editor" | "preview";
  setMode: (m: "editor" | "preview") => void;
  onRun: () => void;
  onStop: () => void;
  canStop: boolean;
  devices: RemoteDeviceStatus["devices"];
  selectedDeviceId: string;
  setSelectedDeviceId: (id: string) => void;
  sessions: LiveSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  uiError: string | null;
  source: string;
  onSourceChange: (v: string) => void;
  remoteUiRoot: RemoteUiNode | null;
  plotDataByNodeId: Record<string, RemotePlotData>;
  previewResult: ReturnType<typeof evalEmwUi> | null;
  runtimeOwnerLabel: string;
  liveScript: boolean;
  onRemoteEvent: (targetId: string, name: string, payload: unknown) => void;
}) {
  const {
    filename,
    subtitle,
    canPreview,
    mode,
    setMode,
    onRun,
    onStop,
    canStop,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    sessions,
    activeSessionId,
    onSelectSession,
    uiError,
    source,
    onSourceChange,
    remoteUiRoot,
    plotDataByNodeId,
    previewResult,
    runtimeOwnerLabel,
    liveScript,
    onRemoteEvent,
  } = props;

  const showPreview = canPreview && mode === "preview";

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-col gap-3 border-b border-[color:var(--line)] bg-[color:var(--surface)] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex h-5 w-10 items-center justify-center rounded-md border border-[color:var(--line)] bg-[color:var(--surface-2)] font-mono text-[9px] uppercase tracking-wider text-[color:var(--ink-dim)]"
              aria-hidden
            >
              .emw
            </span>
            <div className="truncate font-mono text-[13px] font-semibold text-[color:var(--ink)]">
              {filename}
            </div>
            {liveScript ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--aqua-tint-2)] bg-[color:var(--aqua-tint)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--aqua)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--aqua)]" aria-hidden />
                live
              </span>
            ) : null}
          </div>
          <div className="mt-1 line-clamp-1 text-[11px] text-[color:var(--ink-dim)]">{subtitle}</div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {canPreview ? (
            <div className="inline-flex overflow-hidden rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] p-0.5">
              <SegButton active={mode === "editor"} onClick={() => setMode("editor")}>
                Editor
              </SegButton>
              <SegButton active={mode === "preview"} onClick={() => setMode("preview")}>
                Preview
              </SegButton>
            </div>
          ) : null}

          <select
            value={selectedDeviceId}
            onChange={(event) => setSelectedDeviceId(event.target.value)}
            className="h-9 max-w-[260px] rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-3 text-[12px] text-[color:var(--ink)] outline-none"
            title="Device to run the next script on"
          >
            <option value="">Active device</option>
            {(devices || []).map((device) => (
              <option key={device.id || device.name} value={device.id || ""}>
                {(device.name || device.id || "Device") + (device.connected ? " · connected" : "")}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onRun}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[color:var(--aqua-tint-2)] bg-[color:var(--aqua-tint)] px-3 text-[13px] font-semibold text-[color:var(--aqua)] transition hover:bg-[color:var(--aqua-tint-2)]"
          >
            <RunIcon />
            Run on device
          </button>
          <button
            type="button"
            onClick={onStop}
            disabled={!canStop}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-3 text-[13px] font-semibold text-[color:var(--ink)] transition hover:border-[color:var(--danger-tint-2)] hover:bg-[color:var(--danger-tint)] hover:text-[color:var(--danger)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[color:var(--surface-2)] disabled:hover:text-[color:var(--ink)]"
          >
            <StopIcon />
            Stop
          </button>
        </div>
      </header>

      {uiError ? (
        <div className="mx-5 mt-3 rounded-xl border border-[color:var(--danger-tint-2)] bg-[color:var(--danger-tint)] px-3 py-2 text-[12px] leading-5 text-[color:var(--danger)] whitespace-pre-wrap">
          {uiError}
        </div>
      ) : null}

      {sessions.length ? (
        <div className="mx-5 mt-3 flex flex-wrap gap-2 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-2">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => onSelectSession(session.id)}
              className={`rounded-xl border px-3 py-2 text-left text-[12px] transition ${
                activeSessionId === session.id
                  ? "border-[color:var(--aqua-tint-2)] bg-[color:var(--aqua-tint)] text-[color:var(--aqua)]"
                  : "border-[color:var(--line)] bg-[color:var(--surface-2)] text-[color:var(--ink)] hover:border-[color:var(--sky-tint-2)]"
              }`}
            >
              <div className="font-semibold">{session.name}</div>
              <div className="mt-0.5 max-w-[260px] truncate font-mono text-[10px] opacity-70">
                {session.deviceId || "active device"}
              </div>
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col p-5">
        {showPreview ? (
          <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-[color:var(--line)] bg-[color:var(--image-well)] p-5">
            {remoteUiRoot ? (
              <>
                <RemoteEmwUi
                  root={remoteUiRoot}
                  plotDataByNodeId={plotDataByNodeId}
                  onEvent={onRemoteEvent}
                />
                <div className="mt-3 text-[11px] text-[color:var(--ink-dim)]">
                  Live: UI and interactions are running on the {runtimeOwnerLabel.toLowerCase()}.
                </div>
              </>
            ) : previewResult?.error ? (
              <div className="rounded-lg border border-[color:var(--danger-tint-2)] bg-[color:var(--danger-tint)] px-3 py-2 text-[12px] text-[color:var(--danger)] whitespace-pre-wrap">
                {previewResult.error}
              </div>
            ) : previewResult?.root ? (
              <>
                <EmwUiPreview root={previewResult.root} />
                <div className="mt-3 text-[11px] text-[color:var(--ink-dim)]">
                  Preview: controls are disabled and device APIs are stubbed.
                </div>
              </>
            ) : (
              <EmptyState
                title="No UI to render"
                hint="Add a UI.render(...) call to your script, or hit Run to launch on the runtime."
              />
            )}
          </div>
        ) : (
          <textarea
            value={source}
            onChange={(event) => onSourceChange(event.target.value)}
            spellCheck={false}
            className="min-h-0 flex-1 w-full resize-none rounded-2xl border border-[color:var(--line)] bg-[color:var(--image-well)] p-4 font-mono text-[12px] leading-relaxed text-[color:var(--ink)] outline-none focus:border-[color:var(--sky-tint-2)] focus:ring-2 focus:ring-[color:var(--sky-tint)]"
            placeholder="-- Write or paste an .emw script…"
          />
        )}
      </div>
    </section>
  );
}

function SegButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex h-8 items-center rounded-lg px-3 text-[12px] font-semibold transition " +
        (active
          ? "bg-[color:var(--surface)] text-[color:var(--ink)] shadow-[0_0_0_1px_var(--line)]"
          : "text-[color:var(--ink-dim)] hover:text-[color:var(--ink)]")
      }
    >
      {children}
    </button>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-1 text-center">
      <div className="text-[14px] font-semibold text-[color:var(--ink)]">{title}</div>
      <div className="max-w-sm text-[12px] leading-5 text-[color:var(--ink-dim)]">{hint}</div>
    </div>
  );
}

/* ─────────────────────────── Icons ─────────────────────────── */

function RunIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 fill-current">
      <path d="M4.5 3.2a.6.6 0 0 1 .9-.52l7.05 4.32a.6.6 0 0 1 0 1.03L5.4 12.36a.6.6 0 0 1-.9-.52V3.2Z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-3 w-3 fill-current">
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className="h-full w-full fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4.5h7.5a2.5 2.5 0 0 1 2.5 2.5v9a1 1 0 0 1-1.4.92L9 14.5l-3.6 2.42A1 1 0 0 1 4 16V4.5Z" />
      <path d="M14 7v9a1 1 0 0 0 1.4.92L17 16" />
    </svg>
  );
}

function RuntimeIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className="h-full w-full fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="6" width="12" height="9" rx="1.5" />
      <path d="M7 4.5v1.5M13 4.5v1.5M7 15v1.5M13 15v1.5M2.5 8.5H4M2.5 11.5H4M16 8.5h1.5M16 11.5h1.5" />
      <rect x="7.5" y="9.5" width="5" height="2" rx="0.5" />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className="h-full w-full fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2.5v2" />
      <rect x="3.5" y="4.5" width="13" height="11" rx="2.5" />
      <circle cx="7.5" cy="10" r="1" />
      <circle cx="12.5" cy="10" r="1" />
      <path d="M8 13h4" />
    </svg>
  );
}

function LogIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className="h-full w-full fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="13" height="13" rx="2" />
      <path d="M6.5 7.5h7M6.5 10h7M6.5 12.5h4.5" />
    </svg>
  );
}
