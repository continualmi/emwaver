"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";

import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { firebaseAuth, googleProvider, isFirebaseConfigured } from "@/lib/firebase";
import { downloadFileContent, listFiles } from "@/lib/backend";
import { backendWsUrl, type RemoteIncomingMessage, wsSend } from "@/lib/remoteSessions";
import { RemoteEmwUi } from "@/components/RemoteEmwUi";

export default function RemoteHostPage({ params }: { params: { hostId: string } }) {
  const hostId = String((params as any)?.hostId || "");

  const auth = useMemo(() => (isFirebaseConfigured() ? firebaseAuth() : null), []);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [idToken, setIdToken] = useState<string>("");

  const [wsStatus, setWsStatus] = useState<string>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);

  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>("");

  const [scriptInstanceId, setScriptInstanceId] = useState<string>("");
  const [uiRev, setUiRev] = useState<number>(0);
  const [uiRoot, setUiRoot] = useState<any>(null);

  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function appendLog(line: string) {
    setLog((prev) => [...prev.slice(-200), `[${new Date().toLocaleTimeString()}] ${line}`]);
  }

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      setError(null);
      if (!u) {
        setUserEmail(null);
        setIdToken("");
        setFiles([]);
        setSelectedFile("");
        return;
      }
      setUserEmail(u.email || u.displayName || "Signed in");
      const tok = await u.getIdToken();
      setIdToken(tok);
      const all = await listFiles(tok);
      const emw = all.map((f) => f.name).filter((n) => n.toLowerCase().endsWith(".emw"));
      setFiles(emw);
      if (!selectedFile && emw.length > 0) setSelectedFile(emw[0]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  function connectWs(tok: string) {
    if (!tok) return;
    if (!hostId) {
      setError("Missing hostId in route. Open this page via /cloud/hosts and click 'Remote control' on a host.");
      return;
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    setWsStatus("connecting");
    const ws = new WebSocket(backendWsUrl(tok));
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus("open");
      appendLog(`WS open (hostId=${hostId || "(missing)"})`);
      wsSend(ws, { type: "hello", role: "web", protocolVersion: 1 });
      if (hostId) {
        wsSend(ws, { type: "host.attach", hostSessionId: hostId });
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data || "{}")) as RemoteIncomingMessage;
        if (!msg || typeof msg.type !== "string") return;

        if (msg.type === "host.attached") {
          appendLog(`attached to host ${msg.hostSessionId}`);
        } else if (msg.type === "host.error") {
          setError(`host error: ${msg.error}`);
        } else if (msg.type === "script.started") {
          setScriptInstanceId(msg.scriptInstanceId);
          appendLog(`script started: ${msg.scriptInstanceId}`);
        } else if (msg.type === "ui.snapshot") {
          setScriptInstanceId(msg.scriptInstanceId);
          setUiRev(msg.rev);
          setUiRoot(msg.root);
        } else if (msg.type === "script.error") {
          setError(msg.error);
        } else if (msg.type === "error") {
          setError(String((msg as any).error || "error"));
        }
      } catch (e: any) {
        appendLog(`bad message: ${String(e?.message || e)}`);
      }
    };

    ws.onclose = () => {
      setWsStatus("closed");
      appendLog("WS closed");
    };

    ws.onerror = () => {
      setWsStatus("error");
      appendLog("WS error");
    };
  }

  async function doSignIn() {
    setError(null);
    if (!auth) {
      setError(
        "Firebase env is missing. Set NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_PROJECT_ID, NEXT_PUBLIC_FIREBASE_APP_ID",
      );
      return;
    }
    await signInWithPopup(auth, googleProvider());
  }

  async function doSignOut() {
    setError(null);
    if (!auth) return;
    await signOut(auth);
  }

  async function runSelected() {
    setError(null);
    if (!idToken) return;
    if (!selectedFile) {
      setError("Pick a script first");
      return;
    }

    connectWs(idToken);

    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError("WS not connected yet (try again in a second)");
      return;
    }

    const bytes = await downloadFileContent(selectedFile, idToken);
    const src = new TextDecoder("utf-8").decode(bytes);

    wsSend(ws, {
      type: "script.run",
      hostSessionId: hostId,
      name: selectedFile,
      source: src,
    });
  }

  function sendUiEvent(targetNodeId: string, name: string, payload: any) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!scriptInstanceId) return;

    wsSend(ws, {
      type: "ui.event",
      hostSessionId: hostId,
      scriptInstanceId,
      baseRev: uiRev,
      targetNodeId,
      name,
      payload: payload || {},
    });
  }

  return (
    <div className="min-h-dvh">
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-5 pt-10 pb-14">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--ink)]">Remote Control</h1>
            <div className="pt-1 text-sm text-[color:var(--ink-dim)]">Host: {hostId}</div>
          </div>

          {!userEmail ? (
            <button
              onClick={doSignIn}
              className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] hover:opacity-95"
            >
              Sign in with Google
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <div className="text-sm text-[color:var(--ink-dim)]">{userEmail}</div>
              <Link
                href="/cloud/hosts"
                className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                Hosts
              </Link>
              <button
                onClick={doSignOut}
                className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                Log out
              </button>
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-[360px_1fr]">
          <aside className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
            <div className="text-sm font-semibold text-[color:var(--ink)]">Connection</div>
            <div className="mt-2 text-xs text-[color:var(--ink-dim)]">WS: {wsStatus}</div>

            <div className="mt-4 text-sm font-semibold text-[color:var(--ink)]">Run Script</div>
            <div className="mt-2 space-y-2">
              <select
                disabled={!idToken}
                value={selectedFile}
                onChange={(e) => setSelectedFile(e.target.value)}
                className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] p-2 text-sm text-[color:var(--ink)] disabled:opacity-50"
              >
                {files.length === 0 ? <option value="">(no .emw files in cloud)</option> : null}
                {files.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>

              <button
                disabled={!idToken || !selectedFile}
                onClick={() => connectWs(idToken)}
                className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] disabled:opacity-50"
              >
                Connect
              </button>

              <button
                disabled={!idToken || !selectedFile}
                onClick={runSelected}
                className="w-full rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] disabled:opacity-50"
              >
                Run on Host
              </button>

              <div className="pt-2 text-xs text-[color:var(--ink-dim)]">scriptInstanceId: {scriptInstanceId || "(none)"}</div>
              <div className="text-xs text-[color:var(--ink-dim)]">uiRev: {uiRev}</div>
            </div>

            {error ? <div className="mt-3 whitespace-pre-wrap text-xs text-red-300">{error}</div> : null}

            <div className="mt-4 text-sm font-semibold text-[color:var(--ink)]">Log</div>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.55)] p-3 font-mono text-xs text-[color:var(--ink)]">
              {log.join("\n")}
            </pre>
          </aside>

          <section className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
            <div className="text-sm font-semibold text-[color:var(--ink)]">Remote UI</div>
            {!uiRoot ? (
              <div className="mt-3 text-sm text-[color:var(--ink-dim)]">Run a script to see UI snapshots.</div>
            ) : (
              <div className="mt-3">
                <RemoteEmwUi root={uiRoot} onEvent={sendUiEvent} />
              </div>
            )}
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
