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
type GatewayDevice = NonNullable<RemoteDeviceStatus["devices"]>[number];
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
  if (deviceStatus.runtimeOwner === "emwaver-gateway") return "gateway connected";
  return "runtime connected";
}

function statusTone(status: WsStatus, deviceStatus: RemoteDeviceStatus | null): "online" | "warn" | "offline" {
  if (status === "error" || status === "closed") return "offline";
  if (status === "connecting") return "warn";
  if (!deviceStatus?.connected) return "warn";
  return "online";
}

function timeOfDay(d = new Date()) {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

type LogSeverity = "info" | "warn" | "error";
type LogEntry = { type: string; at: string; severity: LogSeverity; message: string; raw: RemoteIncomingMessage };
type LiveSession = { id: string; name: string; deviceId: string; root: RemoteUiNode | null; rev: number; plotDataByNodeId: Record<string, RemotePlotData> };

const HEARTBEAT_LOG_TYPES = new Set(["device.status", "ui.snapshot", "plot.data", "hello.ack"]);

function summarizeMessage(msg: RemoteIncomingMessage): { severity: LogSeverity; message: string } | null {
  const type = String(msg.type || "");
  if (HEARTBEAT_LOG_TYPES.has(type)) return null;
  if (type === "script.started") {
    const name = String((msg as { name?: string }).name || "script");
    const device = String((msg as { deviceId?: string }).deviceId || "");
    return { severity: "info", message: device ? `Started ${name} on ${device}` : `Started ${name}` };
  }
  if (type === "script.stopped") {
    const id = String((msg as { scriptInstanceId?: string }).scriptInstanceId || "");
    const reason = String((msg as { reason?: string }).reason || "stopped");
    return { severity: "info", message: id ? `Stopped ${id} (${reason})` : `Stopped (${reason})` };
  }
  if (type === "script.error" || type === "host.error" || type === "error") {
    const err = String((msg as { error?: string }).error || "error");
    return { severity: "error", message: err };
  }
  if (type === "script.list") {
    const scripts = (msg as { scripts?: unknown[] }).scripts;
    const count = Array.isArray(scripts) ? scripts.length : 0;
    return { severity: "info", message: `Sessions: ${count}` };
  }
  return { severity: "info", message: type };
}

function normalizedTransport(value: string) {
  const lower = value.trim().toLowerCase();
  if (lower === "usb" || lower === "ble" || lower === "wifi") return lower;
  return "auto";
}

function deviceKey(device: GatewayDevice) {
  if (device.deviceKey) return device.deviceKey;
  if (device.hardwareUid) return `uid:${device.hardwareUid}`;
  return device.id || device.transportId || "";
}

function groupedDeviceOptions(devices: GatewayDevice[]) {
  const map = new Map<string, { id: string; label: string; transports: GatewayDevice[] }>();
  for (const device of devices) {
    const id = deviceKey(device);
    if (!id) continue;
    const existing = map.get(id);
    const label = device.hardwareUid ? `UID ${device.hardwareUid}` : device.name || id;
    if (existing) {
      existing.transports.push(device);
    } else {
      map.set(id, { id, label, transports: [device] });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
}

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
  const [selectedTransport, setSelectedTransport] = useState("auto");
  const [uiRev, setUiRev] = useState(0);
  const [remoteUiRoot, setRemoteUiRoot] = useState<RemoteUiNode | null>(null);
  const [plotDataByNodeId, setPlotDataByNodeId] = useState<Record<string, RemotePlotData>>({});
  const [uiError, setUiError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [manualWifiHost, setManualWifiHost] = useState("");
  const [manualWifiPort, setManualWifiPort] = useState("3922");
  const [gatewayDevices, setGatewayDevices] = useState<GatewayDevice[]>([]);
  const [gatewayDevicesBusy, setGatewayDevicesBusy] = useState(false);
  const [activity, setActivity] = useState<ActivityId | null>(() => {
    const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    return (["library", "runtime", "agent", "log"] as ActivityId[]).includes(hash as ActivityId)
      ? (hash as ActivityId)
      : "library";
  });
  const [unreadLog, setUnreadLog] = useState(0);
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 320;
    const saved = Number(window.localStorage.getItem("emw.panelWidth"));
    return Number.isFinite(saved) && saved >= 220 && saved <= 600 ? saved : 320;
  });
  const wsRef = useRef<WebSocket | null>(null);
  const activeSessionRef = useRef("");
  const openFileRef = useRef<HTMLInputElement | null>(null);
  const activityRef = useRef<ActivityId | null>("library");

  useEffect(() => {
    activeSessionRef.current = scriptInstanceId;
  }, [scriptInstanceId]);

  useEffect(() => {
    try {
      window.localStorage.setItem("emw.panelWidth", String(panelWidth));
    } catch {
      /* ignore */
    }
  }, [panelWidth]);

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
      const summary = summarizeMessage(msg);
      if (summary) {
        const entry: LogEntry = {
          type: String(msg.type),
          at: timeOfDay(),
          severity: summary.severity,
          message: summary.message,
          raw: msg,
        };
        setLog((items) => [entry, ...items].slice(0, 80));
        setUnreadLog((n) => (activityRef.current === "log" ? 0 : Math.min(n + 1, 99)));
      }

      if (msg.type === "device.status") {
        const status = msg as RemoteDeviceStatus;
        setDeviceStatus(status);
        setSelectedDeviceId(status.settings?.selectedDeviceId || "");
        setSelectedTransport(normalizedTransport(status.settings?.selectedTransport || "auto"));
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
      if (msg.type === "hello.ack") {
        wsSend(ws, { type: "script.list" });
      }
      if (msg.type === "script.list") {
        const scripts = (msg.scripts as Array<{ scriptInstanceId: string; name: string; deviceId?: string; state?: string }> | null) || [];
        const running = scripts.filter((s) => s.state === "running");
        if (running.length > 0) {
          setSessions((items) => {
            const next = { ...items };
            for (const s of running) {
              if (!next[s.scriptInstanceId]) {
                next[s.scriptInstanceId] = { id: s.scriptInstanceId, name: s.name, deviceId: s.deviceId || "", root: null, rev: 0, plotDataByNodeId: {} };
              }
            }
            return next;
          });
          for (const s of running) {
            wsSend(ws, { type: "ui.snapshot.get", scriptInstanceId: s.scriptInstanceId });
          }
        }
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
      window.location.hash = resolved ?? "";
      return resolved;
    });
    if (next === "log") setUnreadLog(0);
  }

  function openExample(example: ExampleScript) {
    setSelected(example.name);
    setSource(example.source);
    setMode("editor");
    setScriptInstanceId("");
    setRemoteUiRoot(null);
    setUiError(null);
  }

  async function saveGatewayTarget(deviceId: string, transport: string) {
    const selectedDeviceUid = deviceId.startsWith("uid:") ? deviceId.slice(4) : null;
    const selectedTransport = normalizedTransport(transport);
    try {
      const response = await fetch("/v1/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          selectedDeviceUid,
          selectedTransport,
          wifiTargets: deviceStatus?.settings?.wifiTargets || [],
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.ok === false) {
        throw new Error(body?.message || body?.error || "settings_failed");
      }
    } catch (error) {
      setUiError(formatError(error));
    }
  }

  function chooseDevice(id: string) {
    setSelectedDeviceId(id);
    void saveGatewayTarget(id, selectedTransport);
  }

  function chooseTransport(transport: string) {
    const normalized = normalizedTransport(transport);
    setSelectedTransport(normalized);
    void saveGatewayTarget(selectedDeviceId, normalized);
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
    wsSend(ws, {
      type: "script.run",
      name: selected || "script.emw",
      source,
      deviceId: selectedDeviceId || undefined,
      transport: selectedTransport === "auto" ? undefined : selectedTransport,
    });
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
    setScriptInstanceId("");
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

  async function refreshGatewayDevices() {
    setGatewayDevicesBusy(true);
    try {
      const response = await fetch("/v1/devices");
      const body = await response.json();
      if (!response.ok || body?.ok === false) {
        throw new Error(body?.message || body?.error || "devices_failed");
      }
      setGatewayDevices(Array.isArray(body.devices) ? body.devices : []);
    } catch (error) {
      setUiError(formatError(error));
    } finally {
      setGatewayDevicesBusy(false);
    }
  }

  function useGatewayWifiDevice(device: GatewayDevice) {
    const host = String(device.host || String(device.endpoint || "").split(":")[0] || "").trim();
    if (!host) return;
    const port = String(device.port || String(device.endpoint || "").split(":")[1] || "3922");
    setManualWifiHost(host);
    setManualWifiPort(port);
    chooseDevice(deviceKey(device));
    chooseTransport("wifi");
    setActivity("runtime");
  }

  function useManualWifiTarget() {
    const host = manualWifiHost.trim();
    const port = manualWifiPort.trim() || "3922";
    if (!host) return;
    setManualWifiHost(host);
    setManualWifiPort(port);
    chooseTransport("wifi");
  }

  const canPreview = !!(selected && isEmw(selected));
  const connected = !!deviceStatus?.connected;
  const tone = statusTone(wsStatus, deviceStatus);
  const liveScript = !!scriptInstanceId;
  const liveSessions = Object.values(sessions);
  const liveSessionForSelected = useMemo(
    () => (selected ? liveSessions.find((s) => s.name === selected) : undefined),
    [liveSessions, selected]
  );

  function selectLiveSession(id: string) {
    const session = sessions[id];
    if (!session) return;
    setScriptInstanceId(id);
    setSelected(session.name);
    setRemoteUiRoot(session.root);
    setUiRev(session.rev);
    setPlotDataByNodeId(session.plotDataByNodeId);
    setMode("preview");
    setUiError(null);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      wsSend(ws, { type: "ui.snapshot.get", scriptInstanceId: id });
    }
  }

  return (
    <div className="flex h-dvh min-h-dvh flex-col overflow-hidden">
      <BrandHeader status={statusLabel(wsStatus, deviceStatus)} tone={tone} />

      <div className="flex min-h-0 flex-1">
        <ActivityRail
          active={activity}
          onSelect={selectActivity}
          unreadLog={unreadLog}
          runtimeOnline={connected}
          runtimeWarn={tone !== "online"}
          hasLiveSessions={liveSessions.length > 0}
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
          selectedDeviceId={selectedDeviceId}
          manualWifiHost={manualWifiHost}
          setManualWifiHost={setManualWifiHost}
          manualWifiPort={manualWifiPort}
          setManualWifiPort={setManualWifiPort}
          gatewayDevices={gatewayDevices}
          gatewayDevicesBusy={gatewayDevicesBusy}
          refreshGatewayDevices={refreshGatewayDevices}
          useGatewayWifiDevice={useGatewayWifiDevice}
          useManualWifiTarget={useManualWifiTarget}
          log={log}
          onClearLog={() => {
            setLog([]);
            setUnreadLog(0);
          }}
          liveSessions={liveSessions}
          activeSessionId={scriptInstanceId}
          onSelectSession={selectLiveSession}
          width={panelWidth}
          setWidth={setPanelWidth}
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
              ? `Local runtime connected — choose a device, run a script, and open a session from the sidebar.`
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
          selectedTransport={selectedTransport}
          setSelectedDeviceId={chooseDevice}
          setSelectedTransport={chooseTransport}
          uiError={uiError}
          source={source}
          onSourceChange={(value) => {
            setSource(value);
            setUiError(null);
          }}
          remoteUiRoot={remoteUiRoot}
          plotDataByNodeId={plotDataByNodeId}
          previewResult={previewResult}
          liveSessionForSelectedId={liveSessionForSelected?.id}
          onOpenLive={() => {
            if (liveSessionForSelected) selectLiveSession(liveSessionForSelected.id);
          }}
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
  unreadLog: number;
  runtimeOnline: boolean;
  runtimeWarn: boolean;
  hasLiveSessions: boolean;
}) {
  const { active, onSelect, unreadLog, runtimeOnline, runtimeWarn, hasLiveSessions } = props;
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
        dot={hasLiveSessions ? "info" : null}
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
  selectedDeviceId: string;
  manualWifiHost: string;
  setManualWifiHost: (v: string) => void;
  manualWifiPort: string;
  setManualWifiPort: (v: string) => void;
  gatewayDevices: GatewayDevice[];
  gatewayDevicesBusy: boolean;
  refreshGatewayDevices: () => void;
  useGatewayWifiDevice: (device: GatewayDevice) => void;
  useManualWifiTarget: () => void;
  log: LogEntry[];
  onClearLog: () => void;
  liveSessions: LiveSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  width: number;
  setWidth: (n: number) => void;
}) {
  const { activity, width, setWidth } = props;
  if (!activity) return null;

  function startResize(event: React.MouseEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(600, Math.max(220, startW + (ev.clientX - startX)));
      setWidth(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  return (
    <aside
      style={{ width }}
      className="relative flex shrink-0 flex-col border-r border-[color:var(--line)] bg-[color:var(--surface-3)]"
    >
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
        {activity === "library" ? <LibraryPanel {...props} liveSessions={props.liveSessions} activeSessionId={props.activeSessionId} onSelectSession={props.onSelectSession} /> : null}
        {activity === "runtime" ? <RuntimePanel {...props} /> : null}
        {activity === "agent" ? <AgentPlaceholderPanel /> : null}
        {activity === "log" ? <LogPanel log={props.log} /> : null}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize side panel"
        onMouseDown={startResize}
        className="group absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize"
      >
        <span className="absolute right-0 top-0 h-full w-px bg-[color:var(--line)] transition group-hover:bg-[color:var(--aqua)] group-active:bg-[color:var(--aqua)]" />
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

function AgentPlaceholderPanel() {
  return (
    <div className="flex h-full flex-col items-start gap-3 p-4">
      <div className="rounded-xl border border-dashed border-[color:var(--line)] bg-[color:var(--surface-3)] px-4 py-6 text-center">
        <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-2)] text-[color:var(--ink-dim)]">
          <span className="h-4 w-4">
            <AgentIcon />
          </span>
        </div>
        <div className="text-[12px] font-semibold text-[color:var(--ink)]">Agent — coming soon</div>
        <div className="mt-1 text-[11px] leading-5 text-[color:var(--ink-dim)]">
          Ask Claude to write or edit .emw scripts, explain code, and walk through
          captures. Local hardware control still works without the agent.
        </div>
      </div>
    </div>
  );
}

function LibraryPanel(props: {
  examples: ExampleScript[];
  selected: string | null;
  openExample: (e: ExampleScript) => void;
  openLocal: () => void;
  saveLocal: () => void;
  liveSessions: LiveSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
}) {
  const { examples, selected, openExample, openLocal, saveLocal, liveSessions, activeSessionId, onSelectSession } = props;

  const sessionByName = useMemo(() => {
    const map = new Map<string, LiveSession>();
    for (const session of liveSessions) map.set(session.name, session);
    return map;
  }, [liveSessions]);

  const exampleNames = useMemo(() => new Set(examples.map((e) => e.name)), [examples]);
  const customSessions = useMemo(
    () => liveSessions.filter((s) => !exampleNames.has(s.name)),
    [liveSessions, exampleNames]
  );

  return (
    <div className="flex flex-col">
      {customSessions.length > 0 && (
        <div className="border-b border-[color:var(--line)]">
          <div className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--aqua)]">
            Custom
          </div>
          <ul className="divide-y divide-[color:var(--line)]">
            {customSessions.map((session) => (
              <SessionRow
                key={session.id}
                name={session.name}
                subtitle={session.deviceId}
                live
                active={activeSessionId === session.id}
                onClick={() => onSelectSession(session.id)}
              />
            ))}
          </ul>
        </div>
      )}

      <div className="border-b border-[color:var(--line)] px-4 py-3">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--aqua)]">
          Examples
        </div>
        <div className="text-[11px] leading-5 text-[color:var(--ink-dim)]">
          Bundled scripts ship with the gateway. Live entries are running on the gateway.
        </div>
      </div>

      {examples.length === 0 ? (
        <div className="px-4 py-6 text-[12px] text-[color:var(--ink-dim)]">No bundled examples.</div>
      ) : (
        <ul className="divide-y divide-[color:var(--line)]">
          {examples.map((example) => {
            const session = sessionByName.get(example.name);
            const live = !!session;
            const active = live ? activeSessionId === session!.id : selected === example.name;
            return (
              <SessionRow
                key={example.name}
                name={example.name}
                subtitle={live ? session!.deviceId : "Bundled example"}
                live={live}
                active={active}
                onClick={() => (live ? onSelectSession(session!.id) : openExample(example))}
              />
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

function SessionRow(props: {
  name: string;
  subtitle?: string;
  live: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const { name, subtitle, live, active, onClick } = props;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={
          "group flex w-full items-center gap-3 px-4 py-3 text-left transition " +
          (active ? "bg-[color:var(--aqua-tint-2)]" : "hover:bg-[color:var(--surface-2)]")
        }
      >
        {live ? (
          <span className="relative flex h-2 w-2 shrink-0 items-center justify-center" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--aqua)] opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[color:var(--aqua)] shadow-[0_0_6px_var(--aqua)]" />
          </span>
        ) : (
          <span className="h-2 w-2 shrink-0 rounded-full bg-transparent" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[12px] font-semibold text-[color:var(--ink)]">
            {name}
          </div>
          {subtitle ? (
            <div className="mt-0.5 truncate font-mono text-[10px] text-[color:var(--ink-dim)]">
              {subtitle}
            </div>
          ) : null}
        </div>
      </button>
    </li>
  );
}

function transportTone(transport?: string): { label: string; cls: string } {
  const t = String(transport || "").toLowerCase();
  if (t === "ble") return { label: "BLE", cls: "text-[color:var(--sky)] border-[color:var(--sky-tint-2)] bg-[color:var(--sky-tint)]" };
  if (t === "usb") return { label: "USB", cls: "text-[color:var(--copper)] border-[color:var(--line)] bg-[color:var(--surface-2)]" };
  if (t === "wi-fi" || t === "wifi") return { label: "Wi-Fi", cls: "text-[color:var(--aqua)] border-[color:var(--aqua-tint-2)] bg-[color:var(--aqua-tint)]" };
  return { label: String(transport || "—").toUpperCase(), cls: "text-[color:var(--ink-dim)] border-[color:var(--line)] bg-[color:var(--surface-2)]" };
}

function DeviceCard({ device, selected }: { device: GatewayDevice; selected: boolean }) {
  const tone = transportTone(device.transport);
  const claimed = (device.connectionState || "").toLowerCase() === "claimed" || device.connected === true;
  const uid = device.hardwareUid || device.id || "";
  const board = device.boardType;
  const endpoint = device.endpoint;
  return (
    <li
      className={
        "rounded-xl border px-3 py-2.5 transition " +
        (selected
          ? "border-[color:var(--aqua-tint-2)] bg-[color:var(--aqua-tint)]"
          : "border-[color:var(--line)] bg-[color:var(--surface-2)]")
      }
    >
      <div className="flex items-center gap-2">
        <span className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone.cls}`}>
          {tone.label}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-semibold text-[color:var(--ink)]">
          {uid || device.name || "device"}
        </span>
        {claimed ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--aqua-tint-2)] bg-[color:var(--aqua-tint)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--aqua)]">
            <span className="h-1 w-1 rounded-full bg-[color:var(--aqua)]" aria-hidden />
            Claimed
          </span>
        ) : (
          <span className="rounded-full border border-[color:var(--line)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--ink-mute)]">
            Free
          </span>
        )}
      </div>
      {(board || endpoint) && (
        <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[color:var(--ink-dim)]">
          {board ? <span>{board}</span> : null}
          {board && endpoint ? <span aria-hidden>·</span> : null}
          {endpoint ? <span className="truncate font-mono">{endpoint}</span> : null}
        </div>
      )}
    </li>
  );
}

function RuntimePanel(props: {
  deviceStatus: RemoteDeviceStatus | null;
  connected: boolean;
  selectedDeviceId: string;
  manualWifiHost: string;
  setManualWifiHost: (v: string) => void;
  manualWifiPort: string;
  setManualWifiPort: (v: string) => void;
  gatewayDevices: GatewayDevice[];
  gatewayDevicesBusy: boolean;
  refreshGatewayDevices: () => void;
  useGatewayWifiDevice: (device: GatewayDevice) => void;
  useManualWifiTarget: () => void;
}) {
  const {
    deviceStatus,
    connected,
    selectedDeviceId,
    manualWifiHost,
    setManualWifiHost,
    manualWifiPort,
    setManualWifiPort,
    gatewayDevices,
    gatewayDevicesBusy,
    refreshGatewayDevices,
    useGatewayWifiDevice,
    useManualWifiTarget,
  } = props;
  const [wifiOpen, setWifiOpen] = useState(false);
  const canUseWifi = !!manualWifiHost.trim();
  const devices = (connected && deviceStatus?.devices) || [];
  const wifiDevices = gatewayDevices.filter(
    (device) => device.transport === "Wi-Fi" && (device.host || device.endpoint)
  );
  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--sky)]">
            Devices
          </div>
          <span className="text-[10px] text-[color:var(--ink-mute)]">
            {devices.length} {devices.length === 1 ? "device" : "devices"}
          </span>
        </div>
        {devices.length > 0 ? (
          <ul className="space-y-2">
            {devices.map((device) => (
              <DeviceCard
                key={device.id || device.hardwareUid || device.name}
                device={device}
                selected={
                  !!selectedDeviceId &&
                  (deviceKey(device) === selectedDeviceId ||
                    `uid:${device.hardwareUid || ""}` === selectedDeviceId)
                }
              />
            ))}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed border-[color:var(--line)] bg-[color:var(--surface-3)] px-3 py-4 text-[12px] text-[color:var(--ink-dim)]">
            {connected
              ? "No devices yet. Plug a board over USB or pair via BLE."
              : "Waiting for the local gateway runtime…"}
          </div>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setWifiOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-3 py-2 text-[12px] font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface)]"
        >
          <span className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--sky)]">
              Wi-Fi target
            </span>
            {wifiDevices.length > 0 ? (
              <span className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface-3)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--ink-dim)]">
                {wifiDevices.length} discovered
              </span>
            ) : null}
          </span>
          <span className="text-[11px] text-[color:var(--ink-mute)]">{wifiOpen ? "−" : "+"}</span>
        </button>

        {wifiOpen ? (
          <div className="mt-2 rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-[color:var(--ink-dim)]">
                {wifiDevices.length ? `${wifiDevices.length} on the network` : "Scan for ESP32 endpoints"}
              </span>
              <button
                type="button"
                onClick={refreshGatewayDevices}
                disabled={gatewayDevicesBusy}
                className="rounded-md border border-[color:var(--line)] bg-[color:var(--surface-3)] px-2 py-1 text-[11px] font-semibold text-[color:var(--ink-dim)] hover:text-[color:var(--ink)] disabled:opacity-50"
              >
                {gatewayDevicesBusy ? "Scanning…" : "Scan"}
              </button>
            </div>
            {wifiDevices.length ? (
              <ul className="mt-2 space-y-1">
                {wifiDevices.slice(0, 4).map((device) => (
                  <li
                    key={device.id || device.endpoint || device.name}
                    className="flex items-center gap-2 rounded-lg bg-[color:var(--surface-3)] px-2 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-semibold text-[color:var(--ink)]">
                        {device.name || device.endpoint}
                      </div>
                      <div className="truncate font-mono text-[10px] text-[color:var(--ink-dim)]">
                        {device.endpoint || device.host}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => useGatewayWifiDevice(device)}
                      className="rounded-md border border-[color:var(--line)] px-2 py-1 text-[11px] font-semibold text-[color:var(--ink-dim)] hover:text-[color:var(--ink)]"
                    >
                      Use
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-3 grid grid-cols-[1fr_72px] gap-2">
              <input
                value={manualWifiHost}
                onChange={(event) => setManualWifiHost(event.target.value)}
                placeholder="Host or IP"
                className="h-9 rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-3)] px-3 text-[13px] text-[color:var(--ink)] outline-none focus:border-[color:var(--sky)]"
              />
              <input
                value={manualWifiPort}
                onChange={(event) => setManualWifiPort(event.target.value)}
                placeholder="3922"
                className="h-9 rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-3)] px-2 text-[13px] text-[color:var(--ink)] outline-none focus:border-[color:var(--sky)]"
              />
            </div>
            <button
              type="button"
              onClick={useManualWifiTarget}
              disabled={!canUseWifi}
              className="mt-2 inline-flex h-9 w-full items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-3)] px-3 text-[13px] font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Use Wi-Fi target
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LogPanel({ log }: { log: LogEntry[] }) {
  if (log.length === 0) {
    return (
      <div className="p-4 text-[12px] text-[color:var(--ink-dim)]">
        Meaningful events (script started, stopped, errors) will appear here. Heartbeats are filtered out.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-[color:var(--line)]">
      {log.map((entry, index) => {
        const dotClass =
          entry.severity === "error"
            ? "bg-[color:var(--danger)]"
            : entry.severity === "warn"
            ? "bg-[color:var(--copper)]"
            : "bg-[color:var(--aqua)]";
        const messageClass =
          entry.severity === "error"
            ? "text-[color:var(--danger)]"
            : "text-[color:var(--ink)]";
        return (
          <li key={index} className="flex items-start gap-3 px-4 py-2.5">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className={`break-words font-mono text-[11px] leading-5 ${messageClass}`}>
                {entry.message}
              </div>
              <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-[color:var(--ink-mute)]">
                <span>{entry.at}</span>
                <span>·</span>
                <span>{entry.type}</span>
              </div>
            </div>
          </li>
        );
      })}
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
  selectedTransport: string;
  setSelectedDeviceId: (id: string) => void;
  setSelectedTransport: (transport: string) => void;
  uiError: string | null;
  source: string;
  onSourceChange: (v: string) => void;
  remoteUiRoot: RemoteUiNode | null;
  plotDataByNodeId: Record<string, RemotePlotData>;
  previewResult: ReturnType<typeof evalEmwUi> | null;
  liveSessionForSelectedId?: string;
  onOpenLive: () => void;
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
    selectedTransport,
    setSelectedDeviceId,
    setSelectedTransport,
    uiError,
    source,
    onSourceChange,
    remoteUiRoot,
    plotDataByNodeId,
    previewResult,
    liveSessionForSelectedId,
    onOpenLive,
    onRemoteEvent,
  } = props;

  const showPreview = canPreview && mode === "preview";
  const deviceOptions = groupedDeviceOptions(devices || []);
  const selectedGroup = deviceOptions.find((group) => group.id === selectedDeviceId);
  const transportChoices = Array.from(
    new Set(
      (selectedGroup?.transports || devices || [])
        .map((device) => normalizedTransport(device.transport || "auto"))
        .filter((transport) => transport !== "auto")
    )
  ).sort((a, b) => ["usb", "ble", "wifi"].indexOf(a) - ["usb", "ble", "wifi"].indexOf(b));

  const isLive = canStop && mode === "preview";

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
            {isLive ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--aqua-tint-2)] bg-[color:var(--aqua-tint)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--aqua)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--aqua)]" aria-hidden />
                live
              </span>
            ) : null}
          </div>
          <div className="mt-1 line-clamp-1 text-[11px] text-[color:var(--ink-dim)]">{subtitle}</div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isLive ? (
            <button
              type="button"
              onClick={onStop}
              disabled={!canStop}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[color:var(--danger-tint-2)] bg-[color:var(--danger-tint)] px-3 text-[13px] font-semibold text-[color:var(--danger)] transition hover:bg-[color:var(--danger-tint-2)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <StopIcon />
              Stop
            </button>
          ) : (
            <>
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
                <option value="">Auto device</option>
                {deviceOptions.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.label}
                  </option>
                ))}
              </select>
              <select
                value={selectedTransport}
                onChange={(event) => setSelectedTransport(event.target.value)}
                className="h-9 max-w-[150px] rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-3 text-[12px] text-[color:var(--ink)] outline-none"
                title="Transport preference for the next script"
              >
                <option value="auto">Auto transport</option>
                {transportChoices.map((transport) => (
                  <option key={transport} value={transport}>
                    {transport.toUpperCase()}
                  </option>
                ))}
              </select>
              {liveSessionForSelectedId ? (
                <button
                  type="button"
                  onClick={onOpenLive}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[color:var(--aqua-tint-2)] bg-[color:var(--aqua-tint)] px-3 text-[13px] font-semibold text-[color:var(--aqua)] transition hover:bg-[color:var(--aqua-tint-2)]"
                  title="Open the running session for this script"
                >
                  <span className="relative flex h-2 w-2 items-center justify-center" aria-hidden>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--aqua)] opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[color:var(--aqua)]" />
                  </span>
                  Open live
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onRun}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[color:var(--aqua-tint-2)] bg-[color:var(--aqua-tint)] px-3 text-[13px] font-semibold text-[color:var(--aqua)] transition hover:bg-[color:var(--aqua-tint-2)]"
                >
                  <RunIcon />
                  Run on device
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {uiError ? (
        <div className="mx-5 mt-3 rounded-xl border border-[color:var(--danger-tint-2)] bg-[color:var(--danger-tint)] px-3 py-2 text-[12px] leading-5 text-[color:var(--danger)] whitespace-pre-wrap">
          {uiError}
        </div>
      ) : null}

      {isLive ? (
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {remoteUiRoot ? (
            <RemoteEmwUi
              root={remoteUiRoot}
              plotDataByNodeId={plotDataByNodeId}
              onEvent={onRemoteEvent}
            />
          ) : (
            <EmptyState
              title="Loading session…"
              hint="Restoring live UI from the gateway."
            />
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col p-5">
          {showPreview ? (
            <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-[color:var(--line)] bg-[color:var(--image-well)] p-5">
              {previewResult?.error ? (
                <div className="rounded-lg border border-[color:var(--danger-tint-2)] bg-[color:var(--danger-tint)] px-3 py-2 text-[12px] text-[color:var(--danger)] whitespace-pre-wrap">
                  {previewResult.error}
                </div>
              ) : previewResult?.root ? (
                <>
                  <EmwUiPreview root={previewResult.root} />
                  <div className="mt-3 text-[11px] text-[color:var(--ink-dim)]">
                    Static preview — controls are disabled and device APIs are stubbed.
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
      )}
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
    <svg viewBox="0 0 24 24" aria-hidden className="h-full w-full fill-none stroke-current" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z" />
      <path d="M9 4h4.5A1.5 1.5 0 0 1 15 5.5v13a1.5 1.5 0 0 1-1.5 1.5H9V4Z" />
      <path d="m17.4 5.05 1.93.52a1.5 1.5 0 0 1 1.06 1.84l-3.36 12.55a1.5 1.5 0 0 1-1.84 1.06l-1.94-.52" />
    </svg>
  );
}

function RuntimeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-full w-full fill-none stroke-current" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="0.6" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </svg>
  );
}

function LogIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-full w-full fill-none stroke-current" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2.4" />
      <path d="m7.5 9 3 3-3 3" />
      <path d="M13 15h4.5" />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-full w-full fill-none stroke-current" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.5v3" />
      <rect x="4" y="5.5" width="16" height="12" rx="3" />
      <circle cx="9" cy="11.5" r="1.1" />
      <circle cx="15" cy="11.5" r="1.1" />
      <path d="M9 14.5h6" />
      <path d="M2 12h2M20 12h2" />
    </svg>
  );
}
