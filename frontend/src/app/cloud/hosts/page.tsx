"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";

import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { firebaseAuth, googleProvider, isFirebaseConfigured } from "@/lib/firebase";
import { listHostSessions, type HostSession } from "@/lib/backend";

function prettyJson(obj: any) {
  try {
    return JSON.stringify(obj ?? {}, null, 2);
  } catch {
    return String(obj ?? "");
  }
}

export default function HostsPage() {
  const auth = useMemo(() => (isFirebaseConfigured() ? firebaseAuth() : null), []);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [idToken, setIdToken] = useState<string>("");

  const [hosts, setHosts] = useState<HostSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = hosts.find((h) => h.id === selectedId) || null;

  async function refresh(tok: string) {
    const r = await listHostSessions(tok);
    setHosts(r.hosts);
    if (!selectedId && r.hosts.length > 0) setSelectedId(r.hosts[0].id);
  }

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      setError(null);
      if (!u) {
        setUserEmail(null);
        setIdToken("");
        setHosts([]);
        setSelectedId(null);
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

  return (
    <div className="min-h-dvh">
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-5 pt-10 pb-14">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--ink)]">Hosts</h1>
            <div className="pt-1 text-sm text-[color:var(--ink-dim)]">Online EMWaver app instances for your account</div>
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
                href="/cloud"
                className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                Dashboard
              </Link>
              <Link
                href="/cloud/agent"
                className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                Agent
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
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-[color:var(--ink)]">Host Sessions</div>
              <button
                disabled={!idToken || isBusy}
                onClick={async () => {
                  if (!idToken) return;
                  setIsBusy(true);
                  setError(null);
                  try {
                    await refresh(idToken);
                  } catch (e: any) {
                    setError(String(e?.message || e));
                  } finally {
                    setIsBusy(false);
                  }
                }}
                className="rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[color:var(--ink)] disabled:opacity-50"
              >
                Refresh
              </button>
            </div>

            <div className="mt-3 overflow-hidden rounded-xl border border-[color:var(--line)]">
              {hosts.length === 0 ? (
                <div className="p-3 text-sm text-[color:var(--ink-dim)]">No hosts online yet.</div>
              ) : (
                <ul className="divide-y divide-[color:var(--line)]">
                  {hosts.map((h) => (
                    <li key={h.id} className={selectedId === h.id ? "bg-[rgba(78,231,199,0.10)]" : ""}>
                      <button
                        type="button"
                        disabled={!idToken || isBusy}
                        onClick={() => setSelectedId(h.id)}
                        className="w-full p-3 text-left"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-semibold text-[color:var(--ink)]">
                            {h.device_name || h.platform || "Host"}
                          </div>
                          <div className={h.online ? "text-xs text-green-300" : "text-xs text-[color:var(--ink-dim)]"}>
                            {h.online ? "online" : "offline"}
                          </div>
                        </div>
                        <div className="pt-1 text-xs text-[color:var(--ink-dim)]">
                          {h.platform} • last seen {new Date(h.last_seen_at_ms).toLocaleString()}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {error ? <div className="mt-3 whitespace-pre-wrap text-xs text-red-300">{error}</div> : null}
          </aside>

          <section className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
            <div className="text-sm font-semibold text-[color:var(--ink)]">Details</div>
            {!selected ? (
              <div className="mt-3 text-sm text-[color:var(--ink-dim)]">Select a host session.</div>
            ) : (
              <div className="mt-3 grid gap-3">
                <div className="rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.35)] p-3">
                  <div className="text-xs font-semibold text-[color:var(--ink-dim)]">ID</div>
                  <div className="mt-1 font-mono text-xs text-[color:var(--ink)]">{selected.id}</div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.35)] p-3">
                    <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Capabilities</div>
                    <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-[rgba(2,4,10,0.55)] p-3 font-mono text-xs text-[color:var(--ink)]">
                      {prettyJson(selected.capabilities)}
                    </pre>
                  </div>
                  <div className="rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.35)] p-3">
                    <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Status</div>
                    <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-[rgba(2,4,10,0.55)] p-3 font-mono text-xs text-[color:var(--ink)]">
                      {prettyJson(selected.status)}
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
