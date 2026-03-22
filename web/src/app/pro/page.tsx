"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup } from "firebase/auth";

import { SiteHeader } from "@/components/SiteHeader";
import { backendFetch } from "@/lib/backend";
import { firebaseAuth, googleProvider, isFirebaseConfigured } from "@/lib/firebase";

type Credits = {
  balance: number;
  monthlyAllowance: number;
  resetsAt?: string | null;
};

type Entitlements = {
  pro: boolean;
  expires_at_ms?: number | null;
  features?: { [k: string]: boolean };
};

function formatUiError(input: unknown): string {
  const raw = String((input as any)?.message ?? input ?? "Request failed");
  const lower = raw.toLowerCase();
  if (
    lower.includes("<!doctype html") ||
    lower.includes("<html") ||
    lower.includes("404: this page could not be found") ||
    lower.includes("next-error-h1")
  ) {
    return "Backend endpoint returned an HTML 404 page. Check backend URL / route configuration.";
  }

  const withoutTags = raw.replace(/<[^>]*>/g, " ");
  const singleLine = withoutTags.replace(/\s+/g, " ").trim();
  if (!singleLine) return "Request failed";
  return singleLine.length > 220 ? `${singleLine.slice(0, 220)}…` : singleLine;
}

export default function ProPage() {
  const auth = useMemo(() => (isFirebaseConfigured() ? firebaseAuth() : null), []);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [idToken, setIdToken] = useState<string>("");
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [credits, setCredits] = useState<Credits | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      setError(null);
      setCredits(null);
      setEntitlements(null);

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
    void refreshEntitlements();
    void refreshCredits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken]);

  async function refreshEntitlements() {
    if (!idToken) return;
    try {
      const res = await backendFetch("/v1/entitlements", idToken, { method: "GET" });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      setEntitlements(JSON.parse(text) as Entitlements);
    } catch {
      setEntitlements(null);
    }
  }

  async function refreshCredits() {
    if (!idToken) return;
    try {
      const res = await backendFetch("/v1/credits", idToken, { method: "GET" });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      setCredits(JSON.parse(text) as Credits);
    } catch {
      // Credits are new; keep the page usable even if backend isn't updated yet.
      setCredits(null);
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
      setError(formatUiError(e));
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

      const res = await backendFetch("/v1/pro/checkout_session", idToken, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      const data = JSON.parse(text) as { url: string };
      window.location.href = data.url;
    } catch (e: any) {
      setError(formatUiError(e));
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
      setError(formatUiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh docs-mode">
      <SiteHeader />
      <main className="flex w-full flex-1 items-center px-5 py-10">
        <div className="mx-auto w-full max-w-5xl rounded-3xl border border-[color:var(--line)] bg-[color:var(--surface-3)] p-6 md:p-10">
          <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">EMWaver Pro</h1>
          <p className="pt-3 text-[15px] leading-7 text-[color:var(--ink-dim)]">
            Pro unlocks cloud features, higher Agent limits, and more device activations. Free users can run scripts and use the Agent with a smaller monthly token allowance, while Pro adds cloud access and more included usage.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
              <div className="text-sm font-semibold text-[color:var(--ink)]">Free vs Pro</div>
              <div className="mt-3 overflow-x-auto rounded-xl border border-[color:var(--line)]">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[color:var(--surface-2)] text-[color:var(--ink)]">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Feature</th>
                      <th className="px-3 py-2 font-semibold">Free</th>
                      <th className="px-3 py-2 font-semibold">Pro</th>
                    </tr>
                  </thead>
                  <tbody className="text-[color:var(--ink-dim)]">
                    <tr className="border-t border-[color:var(--line)]">
                      <td className="px-3 py-2">Run scripts</td>
                      <td className="px-3 py-2">Yes</td>
                      <td className="px-3 py-2">Yes</td>
                    </tr>
                    <tr className="border-t border-[color:var(--line)]">
                      <td className="px-3 py-2">Remote host sessions</td>
                      <td className="px-3 py-2">No</td>
                      <td className="px-3 py-2">Yes</td>
                    </tr>
                    <tr className="border-t border-[color:var(--line)]">
                      <td className="px-3 py-2">Cloud script sync</td>
                      <td className="px-3 py-2">No</td>
                      <td className="px-3 py-2">Yes</td>
                    </tr>
                    <tr className="border-t border-[color:var(--line)]">
                      <td className="px-3 py-2">Unique device activations</td>
                      <td className="px-3 py-2">2 devices</td>
                      <td className="px-3 py-2">Up to 50 devices</td>
                    </tr>
                    <tr className="border-t border-[color:var(--line)]">
                      <td className="px-3 py-2">Agent credits (tokens / month)</td>
                      <td className="px-3 py-2">100K tokens / month</td>
                      <td className="px-3 py-2">10M tokens / month</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-[color:var(--ink)]">Status</div>
                {entitlements?.pro ? (
                  <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--aqua-tint-2)] px-3 py-1 text-xs font-semibold text-[color:var(--aqua)]">
                    Pro active
                  </div>
                ) : null}
              </div>

              <div className="mt-3 space-y-2 text-sm text-[color:var(--ink-dim)]">
                <div>
                  <span className="font-semibold text-[color:var(--ink)]">Account:</span> {userEmail ? userEmail : "Not signed in"}
                </div>

                {idToken ? (
                  <div>
                    <span className="font-semibold text-[color:var(--ink)]">Agent Credits:</span>{" "}
                    {credits ? (
                      <span>
                        {credits.balance} available{credits.monthlyAllowance ? ` / ${credits.monthlyAllowance} per month` : ""}
                      </span>
                    ) : (
                      <span className="text-[color:var(--ink-dim)]">(coming soon)</span>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="mt-4 grid gap-2">
                <button
                  disabled={busy || !!entitlements?.pro}
                  onClick={() => void startProCheckout()}
                  className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] hover:opacity-95 disabled:opacity-50"
                >
                  {entitlements?.pro ? "You already have Pro" : idToken ? "Get Pro" : "Sign in to get Pro"}
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
    </div>
  );
}
