"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup } from "firebase/auth";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { backendFetch } from "@/lib/backend";
import { firebaseAuth, googleProvider, isFirebaseConfigured } from "@/lib/firebase";

type Eligibility = {
  canPurchasePro: boolean;
  reason?: string | null;
  requiresDeviceAttached: boolean;
  hasDeviceAttached: boolean;
};

export default function ProPage() {
  const auth = useMemo(() => (isFirebaseConfigured() ? firebaseAuth() : null), []);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [idToken, setIdToken] = useState<string>("");
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [eligibility, setEligibility] = useState<Eligibility | null>(null);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      setError(null);
      setEligibility(null);

      if (!u) {
        setIdToken("");
        setUserEmail(null);
        return;
      }

      setUserEmail(u.email || u.displayName || "Signed in");
      setIdToken(await u.getIdToken());
    });
  }, [auth]);

  useEffect(() => {
    if (!idToken) return;
    void refreshEligibility();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken]);

  async function refreshEligibility() {
    if (!idToken) return;
    try {
      const res = await backendFetch("/v1/billing/eligibility", idToken, { method: "GET" });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      setEligibility(JSON.parse(text) as Eligibility);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }

  async function doSignIn() {
    setError(null);
    if (!auth) {
      setError("Google sign-in is not configured yet (missing NEXT_PUBLIC_FIREBASE_* env)."
      );
      return;
    }

    try {
      setBusy(true);
      await signInWithPopup(auth, googleProvider());
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function startProCheckout() {
    if (!idToken) {
      await doSignIn();
      return;
    }

    try {
      setBusy(true);
      setError(null);

      // Must be signed in; backend enforces device eligibility.
      const res = await backendFetch("/v1/pro/checkout_session", idToken, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      const data = JSON.parse(text) as { url: string };
      window.location.href = data.url;
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function openPortal() {
    if (!idToken) {
      await doSignIn();
      return;
    }

    try {
      setBusy(true);
      setError(null);

      const res = await backendFetch("/v1/pro/portal", idToken, { method: "POST", body: "{}" });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      const data = JSON.parse(text) as { url: string };
      window.location.href = data.url;
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh docs-mode">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-5 py-10">
        <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-6 md:p-10">
          <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">EMWaver Pro</h1>
          <p className="pt-3 text-[15px] leading-7 text-[color:var(--ink-dim)]">
            Pro unlocks cloud features + the Agent experience. To subscribe, you must be signed in and have at least one verified genuine EMWaver device attached to your account.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
              <div className="text-sm font-semibold text-[color:var(--ink)]">Includes</div>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[color:var(--ink-dim)]">
                <li>Remote host sessions</li>
                <li>File storage + sync across devices</li>
                <li>AI Agent (Pro-only)</li>
                <li>EMWaver-managed inference (no BYO key requirement)</li>
              </ul>
            </div>

            <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
              <div className="text-sm font-semibold text-[color:var(--ink)]">Status</div>

              <div className="mt-3 space-y-2 text-sm text-[color:var(--ink-dim)]">
                <div>
                  <span className="font-semibold text-[color:var(--ink)]">Account:</span> {userEmail ? userEmail : "Not signed in"}
                </div>

                {idToken ? (
                  <div>
                    <span className="font-semibold text-[color:var(--ink)]">Eligibility:</span>{" "}
                    {eligibility ? (
                      eligibility.canPurchasePro ? (
                        <span className="text-[color:var(--aqua)]">Eligible</span>
                      ) : (
                        <span>Not eligible ({eligibility.reason || "unknown"})</span>
                      )
                    ) : (
                      <span>Checking…</span>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="mt-4 grid gap-2">
                <button
                  disabled={busy}
                  onClick={() => void startProCheckout()}
                  className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] hover:opacity-95 disabled:opacity-50"
                >
                  {idToken ? "Get Pro" : "Sign in to get Pro"}
                </button>

                <button
                  disabled={busy}
                  onClick={() => void openPortal()}
                  className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-3)] disabled:opacity-50"
                >
                  Manage subscription
                </button>
              </div>
            </div>
          </div>

          {error ? <div className="mt-4 whitespace-pre-wrap text-xs text-red-300">{error}</div> : null}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
