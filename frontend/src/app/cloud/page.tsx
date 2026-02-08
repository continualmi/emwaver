"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { EmwUiPreview } from "@/components/EmwUiPreview";
import { RemoteEmwUi } from "@/components/RemoteEmwUi";
import { evalEmwUi } from "@/lib/emwUiRuntime";
import { exampleEmwScripts } from "@/lib/exampleEmwScripts";
import { firebaseAuth, googleProvider, isFirebaseConfigured } from "@/lib/firebase";
import {
  deleteFile,
  downloadFileContent,
  listFiles,
  listHostSessions,
  type CloudUserFile,
  type HostSession,
  uploadFile,
} from "@/lib/backend";
import { backendWsUrl, type RemoteIncomingMessage, wsSend } from "@/lib/remoteSessions";
import { loadSelectedHostId, saveSelectedHostId } from "@/lib/hostPrefs";

function isRaw(name: string) {
  return name.toLowerCase().endsWith(".raw");
}
function isTxt(name: string) {
  return name.toLowerCase().endsWith(".txt");
}
function isEmw(name: string) {
  return name.toLowerCase().endsWith(".emw");
}


function stableHash(s: string) {
  // Tiny non-crypto hash for de-duping auto-run.
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function bytesToHexView(bytes: Uint8Array, limit = 256 * 1024) {
  const n = Math.min(bytes.length, limit);
  const lines: string[] = [];
  for (let offset = 0; offset < n; offset += 16) {
    const chunk = bytes.slice(offset, Math.min(offset + 16, n));
    const hex = Array.from(chunk)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
    const ascii = Array.from(chunk)
      .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : "."))
      .join("");
    lines.push(`${offset.toString(16).padStart(8, "0")}  ${hex.padEnd(16 * 3 - 1, " ")}  |${ascii}|`);
  }
  if (bytes.length > limit) lines.push(`\n… truncated to ${limit} bytes (of ${bytes.length})`);
  return lines.join("\n");
}

export default function CloudPage() {
  const auth = useMemo(() => (isFirebaseConfigured() ? firebaseAuth() : null), []);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [idToken, setIdToken] = useState<string>("");
  const [files, setFiles] = useState<CloudUserFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [emwMode, setEmwMode] = useState<"editor" | "preview">("editor");
  const [viewerText, setViewerText] = useState<string>("");

  // Remote host attachment (web becomes a "host dashboard")
  const [hosts, setHosts] = useState<HostSession[]>([]);
  const [selectedHostId, setSelectedHostId] = useState<string>(""); // empty => preview-only
  const [wsStatus, setWsStatus] = useState<"disconnected" | "connecting" | "open" | "error" | "closed">("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const attachedRef = useRef<string>("");
  const manualDisconnectRef = useRef<boolean>(false);
  const reconnectTimerRef = useRef<any>(null);
  const attachRetryTimerRef = useRef<any>(null);
  const selectedHostIdRef = useRef<string>("");
  const idTokenRef = useRef<string>("");
  const [attachedHostId, setAttachedHostId] = useState<string>("");
  const [scriptInstanceId, setScriptInstanceId] = useState<string>("");
  const [uiRev, setUiRev] = useState<number>(0);
  const [remoteUiRoot, setRemoteUiRoot] = useState<any>(null);
  const [plotDataByNodeId, setPlotDataByNodeId] = useState<Record<string, any>>({});
  const lastPlotViewportReqRef = useRef<Record<string, string>>({});
  const [lastAutoRunKey, setLastAutoRunKey] = useState<string>("");

  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);

  function openExample(name: string, source: string) {
    setSelected(name);
    setViewerText(source);
    setUiError(null);
    setEmwMode("editor");
  }

  async function refresh(token: string) {
    setError(null);
    const [f, h] = await Promise.all([listFiles(token), listHostSessions(token)]);
    setFiles(f);
    setHosts(h.hosts || []);
  }

  useEffect(() => {
    // Restore last host selection.
    setSelectedHostId(loadSelectedHostId());
  }, []);

  useEffect(() => {
    selectedHostIdRef.current = selectedHostId;
  }, [selectedHostId]);

  useEffect(() => {
    idTokenRef.current = idToken;
  }, [idToken]);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      setError(null);
      if (!u) {
        setUserEmail(null);
        setIdToken("");
        setFiles([]);
        setHosts([]);
        setSelectedHostId("");
        saveSelectedHostId("");
        setAttachedHostId("");
        setScriptInstanceId("");
        setUiRev(0);
        setRemoteUiRoot(null);
        setPlotDataByNodeId({});
        try {
          wsRef.current?.close();
        } catch {}
        wsRef.current = null;
        setWsStatus("disconnected");

        setSelected(null);
        setViewerText("");
        return;
      }
      setUserEmail(u.email || u.displayName || "Signed in");
      const tok = await u.getIdToken();
      setIdToken(tok);
      await refresh(tok);
    });
  }, [auth]);

  async function doSignIn() {
    setError(null);
    if (!auth) {
      setError(
        "Firebase env is missing. Set NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_PROJECT_ID, NEXT_PUBLIC_FIREBASE_APP_ID"
      );
      return;
    }
    try {
      await signInWithPopup(auth, googleProvider());
    } catch (e: any) {
      const code = e?.code ? String(e.code) : "";
      const msg = e?.message ? String(e.message) : String(e);
      // Common in prod when the deployed domain isn't whitelisted in Firebase Auth.
      // Shows up as auth/unauthorized-domain.
      setError(code ? `${code}: ${msg}` : msg);
    }
  }



  function hostLabel(id: string): string {
    const h = hosts.find((x) => x.id === id);
    return (h?.device_name || h?.platform || "Host").trim();
  }

  function hostIsOnline(id: string): boolean {
    const h = hosts.find((x) => x.id === id);
    return !!h?.online;
  }

  function liveBadge(): { label: string; dotClass: string; title: string } {
    if (!selectedHostId) {
      return { label: "Preview", dotClass: "bg-[color:var(--line)]", title: "Preview-only (no host selected)" };
    }
    if (!hostIsOnline(selectedHostId)) {
      return { label: "Offline", dotClass: "bg-red-400", title: "Selected host is offline" };
    }
    if (wsStatus === "error") {
      return { label: "Error", dotClass: "bg-red-400", title: "WebSocket error" };
    }
    if (wsStatus === "connecting") {
      return { label: "Connecting", dotClass: "bg-amber-300 animate-pulse", title: "Connecting to host…" };
    }
    if (attachedHostId) {
      return { label: "Live", dotClass: "bg-[color:var(--aqua)] animate-pulse", title: "Connected" };
    }
    // Selected and online but not attached yet.
    return { label: "Connecting", dotClass: "bg-amber-300 animate-pulse", title: "Connecting to host…" };
  }
  async function doSignOut() {
    setError(null);
    if (!auth) return;
    await signOut(auth);
  }

  function clearTimers() {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (attachRetryTimerRef.current) {
      clearTimeout(attachRetryTimerRef.current);
      attachRetryTimerRef.current = null;
    }
  }

  function disconnectHost() {
    manualDisconnectRef.current = true;
    clearTimers();

    saveSelectedHostId("");
    setSelectedHostId("");
    setAttachedHostId("");
    attachedRef.current = "";
    setScriptInstanceId("");
    setUiRev(0);
    setRemoteUiRoot(null);
    setPlotDataByNodeId({});
    try {
      wsRef.current?.close();
    } catch {}
    wsRef.current = null;
    setWsStatus("disconnected");
  }

  function connectToHost(tok: string, hostSessionId: string) {
    if (!tok || !hostSessionId) return;

    manualDisconnectRef.current = false;
    clearTimers();

    // Reset any previous session.
    try {
      wsRef.current?.close();
    } catch {}
    wsRef.current = null;

    setWsStatus("connecting");
    setAttachedHostId("");
    attachedRef.current = "";
    setScriptInstanceId("");
    setUiRev(0);
    setRemoteUiRoot(null);
    setPlotDataByNodeId({});

    const ws = new WebSocket(backendWsUrl(tok));
    wsRef.current = ws;

    const sendAttach = () => {
      try {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (attachedRef.current) return;
        wsSend(ws, { type: "host.attach", hostSessionId });
      } catch {
        // ignore
      }
    };

    ws.onopen = () => {
      setWsStatus("open");
      wsSend(ws, { type: "hello", role: "web", protocolVersion: 1 });
      sendAttach();

      // If we don't get host.attached (lost message, backend hiccup), retry attach a few times.
      const tick = () => {
        if (attachedRef.current) return;
        if (ws.readyState !== WebSocket.OPEN) return;
        sendAttach();
        attachRetryTimerRef.current = setTimeout(tick, 1000);
      };
      attachRetryTimerRef.current = setTimeout(tick, 1000);
    };

    ws.onclose = () => {
      setWsStatus("closed");
      setAttachedHostId("");
      attachedRef.current = "";

      // Auto-reconnect if a host is selected and user didn't explicitly disconnect.
      if (manualDisconnectRef.current) return;
      const desired = selectedHostIdRef.current;
      const tokNow = idTokenRef.current;
      if (!desired || !tokNow) return;

      reconnectTimerRef.current = setTimeout(() => {
        // Only reconnect if selection is unchanged.
        if (selectedHostIdRef.current !== desired) return;
        connectToHost(tokNow, desired);
      }, 800);
    };

    ws.onerror = () => {
      setWsStatus("error");
      // onclose will handle reconnect.
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data || "{}")) as RemoteIncomingMessage;
        if (!msg || typeof msg.type !== "string") return;

        if (msg.type === "host.attached") {
          setAttachedHostId(msg.hostSessionId);
          attachedRef.current = msg.hostSessionId;
          clearTimers();
          return;
        }
        if (msg.type === "host.error") {
          setError(`host error: ${msg.error}`);
          setAttachedHostId("");
          attachedRef.current = "";
          return;
        }
        if (msg.type === "script.started") {
          setScriptInstanceId(msg.scriptInstanceId);
          setPlotDataByNodeId({});
          return;
        }
        if (msg.type === "script.stopped") {
          setScriptInstanceId("");
          setRemoteUiRoot(null);
          setUiRev(0);
          setPlotDataByNodeId({});
          return;
        }
        function walkNodes(n: any, out: any[]) {
          if (!n || typeof n !== "object") return;
          out.push(n);
          const kids = Array.isArray(n.children) ? n.children : [];
          for (const c of kids) walkNodes(c, out);
        }

        if (msg.type === "ui.snapshot") {
          setScriptInstanceId(msg.scriptInstanceId);
          setUiRev(msg.rev);
          setRemoteUiRoot(msg.root);

          // Ensure the plot viewport data matches whatever the host UI is showing.
          // (macOS can change the viewport locally; those changes flow via ui.snapshot.)
          try {
            const ws = wsRef.current;
            if (ws && ws.readyState === WebSocket.OPEN) {
              const nodes: any[] = [];
              walkNodes((msg as any).root, nodes);
              for (const n of nodes) {
                if (n?.type !== "plot") continue;
                const nodeId = String(n?.id || "");
                if (!nodeId) continue;
                const p = (n?.props || {}) as any;
                const min = Number(p.xMin ?? p.xDomainMin ?? p.xBoundsMin ?? 0);
                const max = Number(p.xMax ?? p.xDomainMax ?? p.xBoundsMax ?? (min + 1));
                if (!isFinite(min) || !isFinite(max) || max <= min) continue;
                const key = `${min}:${max}`;
                if (lastPlotViewportReqRef.current[nodeId] === key) continue;
                lastPlotViewportReqRef.current[nodeId] = key;
                wsSend(ws, {
                  type: "plot.viewport",
                  hostSessionId: attachedRef.current,
                  scriptInstanceId: (msg as any).scriptInstanceId,
                  baseRev: (msg as any).rev,
                  targetNodeId: nodeId,
                  payload: { min, max, bins: 400 },
                });
              }
            }
          } catch {
            // ignore
          }

          return;
        }
        if (msg.type === "plot.data") {
          const targetNodeId = String((msg as any).targetNodeId || "");
          if (!targetNodeId) return;
          setPlotDataByNodeId((prev) => ({ ...prev, [targetNodeId]: msg }));
          return;
        }
        if (msg.type === "script.error") {
          setError(`script error: ${msg.error}`);
          return;
        }
        if (msg.type === "error") {
          setError(String((msg as any).error || "error"));
          return;
        }
      } catch {
        // ignore
      }
    };
  }

  useEffect(() => {
    // Auto-attach when a host is selected.
    if (!idToken) return;
    if (!selectedHostId) return;

    // If the host disappeared (offline), keep selection but don't connect.
    const h = hosts.find((x) => x.id === selectedHostId);
    if (!h || !h.online) {
      setAttachedHostId("");
      return;
    }

    saveSelectedHostId(selectedHostId);
    connectToHost(idToken, selectedHostId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken, selectedHostId]);

  function runOpenScriptOnHost(reason: string) {
    if (!attachedHostId) return;
    if (!selected || !isEmw(selected)) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const key = `${attachedHostId}:${selected}:${stableHash(viewerText)}`;
    if (key === lastAutoRunKey) return;
    setLastAutoRunKey(key);

    wsSend(ws, {
      type: "script.run",
      hostSessionId: attachedHostId,
      name: selected,
      source: viewerText,
      // debug hint (ignored by host/backends that don't care)
      reason,
    });
  }

  // Auto-run currently open script on attached host when entering Preview mode.
  // This removes the extra “Run on Host” step: selecting a host implies intent to run there.
  useEffect(() => {
    if (!idToken) return;
    if (!attachedHostId) return;
    if (emwMode !== "preview") return;
    runOpenScriptOnHost("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken, attachedHostId, emwMode, viewerText, selected, wsStatus]);

  // If we disconnect (or switch hosts), allow auto-run again.
  useEffect(() => {
    if (!attachedHostId) setLastAutoRunKey("");
  }, [attachedHostId]);
  async function openFile(name: string) {
    if (!idToken) return;
    setIsBusy(true);
    setError(null);
    setSelected(name);
    try {
      const buf = await downloadFileContent(name, idToken);
      const bytes = new Uint8Array(buf);
      if (isRaw(name)) {
        setViewerText(bytesToHexView(bytes));
      } else {
        // try utf-8
        const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        setViewerText(text);
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setIsBusy(false);
    }
  }

  async function saveCurrent() {
    if (!idToken || !selected) return;
    if (isRaw(selected)) {
      setError("Editing .raw in-browser not supported yet (viewer only)");
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      const bytes = new TextEncoder().encode(viewerText);
      const ct = isEmw(selected) || isTxt(selected) ? "text/plain" : "application/octet-stream";
      await uploadFile(selected, bytes, ct, Date.now(), idToken);
      await refresh(idToken);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setIsBusy(false);
    }
  }

  async function doDelete(name: string) {
    if (!idToken) return;
    if (!confirm(`Delete ${name}?`)) return;
    setIsBusy(true);
    setError(null);
    try {
      await deleteFile(name, idToken);
      setSelected(null);
      setViewerText("");
      await refresh(idToken);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setIsBusy(false);
    }
  }

  async function doUploadFromPicker(file: File) {
    if (!idToken) return;
    setIsBusy(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const ct = file.type || (isTxt(file.name) || isEmw(file.name) ? "text/plain" : "application/octet-stream");
      await uploadFile(file.name, bytes, ct, Date.now(), idToken);
      await refresh(idToken);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="min-h-dvh">
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-5 pt-10 pb-14">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--ink)]">Dashboard</h1>
            <div className="pt-1 text-sm text-[color:var(--ink-dim)]">Cloud file browser + editor</div>
          </div>

          {!userEmail ? (
            <button
              onClick={doSignIn}
              className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] hover:opacity-95"
            >
              Sign in with Google
            </button>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-3">
              <div className="text-sm text-[color:var(--ink-dim)]">{userEmail}</div>

              <div className="flex items-center gap-2">
                <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Host</div>
                <select
                  disabled={!idToken}
                  value={selectedHostId}
                  onChange={(e) => {
                    const next = String(e.target.value || "");
                    setSelectedHostId(next);
                    if (!next) disconnectHost();
                    else saveSelectedHostId(next);
                  }}
                  className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-2 text-sm font-semibold text-[color:var(--ink)] disabled:opacity-50"
                  title="Select a host to enable live script control (otherwise preview-only)"
                >
                  <option value="">None (Preview)</option>
                  {hosts.map((h) => (
                    <option key={h.id} value={h.id}>
                      {(h.device_name || h.platform || "Host") + (h.online ? "" : " (offline)")}
                    </option>
                  ))}
                </select>

                {(() => {
                  const b = liveBadge();
                  const hostText = selectedHostId ? hostLabel(selectedHostId) : "";
                  return (
                    <div
                      className={`inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] px-3 py-1 text-xs font-semibold ${b.label === "Live" ? "bg-[rgba(78,231,199,0.12)] text-[color:var(--ink)]" : b.label === "Connecting" ? "bg-[rgba(245,158,11,0.10)] text-[color:var(--ink)]" : b.label === "Offline" || b.label === "Error" ? "bg-[rgba(239,68,68,0.10)] text-[color:var(--ink)]" : "bg-[rgba(255,255,255,0.03)] text-[color:var(--ink-dim)]"}`}
                      title={b.title}
                    >
                      <span className={`h-2 w-2 rounded-full ${b.dotClass}`} />
                      <span>{b.label}{hostText ? ` • ${hostText}` : ""}</span>
                    </div>
                  );
                })()}

              </div>

              <a
                href="/cloud/agent"
                className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                Agent
              </a>
              <button
                onClick={doSignOut}
                className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                Log out
              </button>
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-[340px_1fr]">
          <aside className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-[color:var(--ink)]">Scripts</div>
              <button
                disabled={!idToken || isBusy}
                onClick={() => idToken && refresh(idToken)}
                className="rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[color:var(--ink)] disabled:opacity-50"
              >
                Refresh
              </button>
            </div>

            <div className="mt-3">
              <label className="block text-xs font-semibold text-[color:var(--ink-dim)]">Upload</label>
              <input
                type="file"
                disabled={!idToken || isBusy}
                className="mt-2 w-full rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-2)] p-2 text-xs text-[color:var(--ink)] disabled:opacity-50"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void doUploadFromPicker(f);
                  e.currentTarget.value = "";
                }}
              />
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-[color:var(--line)]">
              <div className="border-b border-[color:var(--line)] bg-[rgba(2,4,10,0.35)] px-3 py-2 text-xs font-semibold text-[color:var(--ink-dim)]">
                Example Scripts
              </div>
              <ul className="divide-y divide-[color:var(--line)]">
                {exampleEmwScripts.map((s) => (
                  <li key={s.name} className={selected === s.name ? "bg-[rgba(78,231,199,0.10)]" : ""}>
                    <button
                      type="button"
                      onClick={() => openExample(s.name, s.source)}
                      className="w-full p-3 text-left"
                    >
                      <div className="font-semibold text-[color:var(--ink)]">{s.name}</div>
                      <div className="pt-0.5 text-xs text-[color:var(--ink-dim)]">Bundled example</div>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="border-y border-[color:var(--line)] bg-[rgba(2,4,10,0.35)] px-3 py-2 text-xs font-semibold text-[color:var(--ink-dim)]">
                Cloud Files
              </div>

              {files.length === 0 ? (
                <div className="p-3 text-sm text-[color:var(--ink-dim)]">
                  No files indexed yet. First sync/upload will populate Postgres.
                </div>
              ) : (
                <ul className="divide-y divide-[color:var(--line)]">
                  {files.map((f) => (
                    <li key={f.name} className={selected === f.name ? "bg-[rgba(91,192,255,0.10)]" : ""}>
                      <div className="flex items-start justify-between gap-3 p-3">
                        <button
                          onClick={() => void openFile(f.name)}
                          className="flex-1 text-left"
                          disabled={!idToken || isBusy}
                        >
                          <div className="font-semibold text-[color:var(--ink)]">{f.name}</div>
                          <div className="pt-0.5 text-xs text-[color:var(--ink-dim)]">{(f.size_bytes ?? 0).toLocaleString()} bytes</div>
                        </button>
                        <button
                          disabled={!idToken || isBusy}
                          onClick={() => void doDelete(f.name)}
                          className="rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-3)] disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {error ? <div className="mt-3 whitespace-pre-wrap text-xs text-red-300">{error}</div> : null}
          </aside>

<section className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm font-semibold text-[color:var(--ink)]">{selected ? selected : "Viewer"}</div>
              <div className="flex items-center gap-2">
                {selected && isEmw(selected) ? (
                  <div className="mr-2 flex overflow-hidden rounded-lg border border-[color:var(--line)]">
                    <button
                      type="button"
                      onClick={() => setEmwMode("editor")}
                      className={`px-3 py-1.5 text-xs font-semibold ${emwMode === "editor" ? "bg-[color:var(--surface-2)] text-[color:var(--ink)]" : "bg-transparent text-[color:var(--ink-dim)]"}`}
                    >
                      Editor
                    </button>
                    <button
                      type="button"
                      onClick={() => setEmwMode("preview")}
                      className={`px-3 py-1.5 text-xs font-semibold ${emwMode === "preview" ? "bg-[color:var(--surface-2)] text-[color:var(--ink)]" : "bg-transparent text-[color:var(--ink-dim)]"}`}
                    >
                      Preview
                    </button>
                  </div>
                ) : null}

                {attachedHostId && scriptInstanceId ? (
                  <button
                    type="button"
                    onClick={() => {
                      const ws = wsRef.current;
                      if (!ws || ws.readyState !== WebSocket.OPEN) return;
                      wsSend(ws, {
                        type: "script.stop",
                        hostSessionId: attachedHostId,
                        scriptInstanceId,
                      });
                    }}
                    className="rounded-lg border border-[color:var(--line)] bg-[rgba(244,63,94,0.12)] px-3 py-1.5 text-xs font-semibold text-[rgb(251,113,133)]"
                  >
                    Stop
                  </button>
                ) : null}

                <button
                  disabled={!selected || isBusy || !idToken}
                  onClick={saveCurrent}
                  className="rounded-lg bg-[color:var(--ink)] px-3 py-1.5 text-xs font-semibold text-[color:var(--paper)] disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>

            {selected && isEmw(selected) && emwMode === "preview" ? (
              <div className="mt-3 space-y-3">

                {attachedHostId && remoteUiRoot ? (
                  <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
                    <RemoteEmwUi
                      root={remoteUiRoot}
                      plotDataByNodeId={plotDataByNodeId}
                      onEvent={(targetId, name, payload) => {
                        const ws = wsRef.current;
                        if (!ws || ws.readyState !== WebSocket.OPEN) return;
                        if (!scriptInstanceId) return;
                        wsSend(ws, {
                          type: "ui.event",
                          hostSessionId: attachedHostId,
                          scriptInstanceId,
                          baseRev: uiRev,
                          targetNodeId: targetId,
                          name,
                          payload: payload || {},
                        });
                      }}
                    />
                    <div className="mt-3 text-xs text-[color:var(--ink-dim)]">Live mode: UI and interactions are running on the host.</div>
                  </div>
                ) : (
                  <div>
                    {(() => {
                      const r = evalEmwUi(viewerText);
                      if (r.error) {
                        return <div className="whitespace-pre-wrap text-xs text-red-300">{r.error}</div>;
                      }
                      if (!r.root) {
                        return <div className="text-sm text-[color:var(--ink-dim)]">No UI.render(...) found.</div>;
                      }
                      return (
                        <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
                          <EmwUiPreview root={r.root} />
                          <div className="mt-3 text-xs text-[color:var(--ink-dim)]">
                            Preview mode: controls are disabled and device APIs are stubbed.
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            ) : (
              <textarea
                value={viewerText}
                onChange={(e) => {
                  setViewerText(e.target.value);
                  setUiError(null);
                }}
                readOnly={selected ? isRaw(selected) : true}
                className="mt-3 h-[calc(100vh-360px)] w-full rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.65)] p-3 font-mono text-xs leading-5 text-[color:var(--ink)] outline-none"
              />
            )}

            {selected && isRaw(selected) ? (
              <div className="mt-2 text-xs text-[color:var(--ink-dim)]">.raw is viewer-only for now.</div>
            ) : null}

          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
