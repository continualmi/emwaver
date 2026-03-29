"use client";

import { signInWithPopup } from "firebase/auth";
import { useEffect, useState } from "react";

import { SiteHeader } from "@/components/SiteHeader";
import { firebaseAuth, googleProvider, isFirebaseConfigured } from "@/lib/firebase";

type HandoffState = {
  code: string;
  expiresAtMs: number | null;
  email: string | null;
};

function formatExpiry(expiresAtMs: number | null) {
  if (!expiresAtMs) return "";
  return new Date(expiresAtMs).toLocaleTimeString();
}

export default function HandoffClient() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<HandoffState | null>(null);

  async function loadCode() {
    const response = await fetch("/api/auth/handoff/code/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: "{}",
    });
    const json = await response.json().catch(() => null) as {
      error?: string;
      code?: string;
      expires_at_ms?: number;
      user?: { email?: string | null };
    } | null;
    if (!response.ok || !json?.code) {
      throw new Error(json?.error || "Unable to issue handoff code.");
    }
    setHandoff({
      code: json.code,
      expiresAtMs: typeof json.expires_at_ms === "number" ? json.expires_at_ms : null,
      email: json.user?.email ?? null,
    });
  }

  async function handleSignIn() {
    setBusy(true);
    setError(null);

    try {
      if (!isFirebaseConfigured()) {
        throw new Error("Firebase is not configured yet.");
      }

      const credential = await signInWithPopup(firebaseAuth(), googleProvider());
      const idToken = await credential.user.getIdToken();

      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ idToken }),
      });
      const json = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(json?.error || "Unable to complete sign-in.");
      }

      await loadCode();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to complete sign-in.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        await loadCode();
      } catch {
        // No local session yet. The button below will handle sign-in.
      }
    })();
  }, []);

  return (
    <div className="min-h-dvh docs-mode">
      <SiteHeader />
      <main className="w-full overflow-y-auto px-5 py-10">
        <div className="rounded-3xl border border-[color:var(--line)] bg-[color:var(--surface-3)] p-6 md:p-10">
          <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">EMWaver desktop sign-in</h1>
          <p className="pt-3 text-[15px] leading-7 text-[color:var(--ink-dim)]">
            Sign in with your Continual account, then paste the one-time EMW handoff code into the native app.
          </p>

          <div className="mt-6 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
            {handoff ? (
              <>
                <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">One-time code</div>
                <div className="pt-3 font-mono text-3xl font-semibold tracking-[0.2em] text-[color:var(--ink)]">
                  {handoff.code}
                </div>
                <div className="pt-3 text-sm text-[color:var(--ink-dim)]">
                  {handoff.email ? `Signed in as ${handoff.email}. ` : ""}
                  This code expires at {formatExpiry(handoff.expiresAtMs)}.
                </div>
              </>
            ) : (
              <>
                <div className="text-sm text-[color:var(--ink-dim)]">
                  Sign in to generate a one-time handoff code for the desktop app.
                </div>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => void handleSignIn()}
                    disabled={busy || !isFirebaseConfigured()}
                    className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] hover:opacity-95 disabled:opacity-50"
                  >
                    {busy ? "Signing in..." : "Continue with Google"}
                  </button>
                </div>
              </>
            )}

            {error ? <div className="pt-4 text-sm text-red-400">{error}</div> : null}
          </div>
        </div>
      </main>
    </div>
  );
}
