"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { backendFetch } from "@/lib/backend";
import { firebaseAuth, isFirebaseConfigured } from "@/lib/firebase";

export default function AuthHandoffPage() {
  const auth = useMemo(() => (isFirebaseConfigured() ? firebaseAuth() : null), []);

  const [idToken, setIdToken] = useState<string>("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [code, setCode] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      setError(null);
      setCode("");
      setExpiresAt(null);

      if (!u) {
        setUserEmail(null);
        setIdToken("");
        return;
      }

      setUserEmail(u.email || u.displayName || "Signed in");
      setIdToken(await u.getIdToken());
    });
  }, [auth]);

  useEffect(() => {
    if (!idToken) return;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken]);

  async function start() {
    try {
      setBusy(true);
      setError(null);
      const res = await backendFetch("/v1/auth/handoff/start", idToken, { method: "POST", body: "{}" });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      const json = JSON.parse(text) as { code: string; expires_at_ms: number };
      setCode(String(json.code || ""));
      setExpiresAt(Number(json.expires_at_ms || 0));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh docs-mode">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 py-10">
        <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-6 md:p-10">
          <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">Sign in with EMWaver</h1>
          <p className="pt-3 text-[15px] leading-7 text-[color:var(--ink-dim)]">
            To sign into the macOS app, copy this code and paste it into the app.
          </p>

          <div className="mt-6 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
            <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">Account</div>
            <div className="pt-2 text-sm text-[color:var(--ink-dim)]">{userEmail || "Not signed in"}</div>

            <div className="mt-5 text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">One-time code</div>
            <div className="mt-2 flex items-center gap-3">
              <div className="flex-1 rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-4 py-3 font-mono text-lg font-semibold text-[color:var(--ink)]">
                {busy ? "…" : code || "(sign in first)"}
              </div>
              <button
                disabled={!code}
                onClick={() => void navigator.clipboard.writeText(code)}
                className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-3 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)] disabled:opacity-50"
              >
                Copy
              </button>
            </div>

            {expiresAt ? (
              <div className="mt-3 text-xs text-[color:var(--ink-dim)]">Expires: {new Date(expiresAt).toLocaleString()}</div>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                disabled={!idToken || busy}
                onClick={() => void start()}
                className="rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] hover:opacity-95 disabled:opacity-50"
              >
                New code
              </button>
              <a
                href="/signin?redirect=%2Fauth%2Fhandoff"
                className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                Switch account
              </a>
            </div>

            {error ? <div className="mt-4 whitespace-pre-wrap text-xs text-red-300">{error}</div> : null}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
