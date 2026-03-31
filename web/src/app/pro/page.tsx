"use client";

import { useEffect, useState } from "react";

import { SiteHeader } from "@/components/SiteHeader";
import { backendFetch } from "@/lib/backend";
import { fetchSessionState, redirectToContinualSignIn } from "@/lib/clientSession";

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
  const raw =
    typeof input === "object" && input !== null && "message" in input
      ? String((input as { message?: unknown }).message ?? "Request failed")
      : String(input ?? "Request failed");
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [idToken, setIdToken] = useState<string>("");
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [credits, setCredits] = useState<Credits | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);

  useEffect(() => {
    void (async () => {
      setError(null);
      setCredits(null);
      setEntitlements(null);

      const session = await fetchSessionState();
      if (!session.user) {
        setIdToken("");
        setUserEmail(null);
        return;
      }

      setUserEmail(session.user.email || session.user.name || "Signed in");
      setIdToken(session.accessToken);
    })();
  }, []);

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
    redirectToContinualSignIn("/pro");
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
    } catch (e: unknown) {
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
    } catch (e: unknown) {
      setError(formatUiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh docs-mode">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-5 py-10">
        <section className="grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
          <div className="rounded-[2rem] border border-[color:var(--line)] bg-[color:var(--glass)] p-6 shadow-[0_24px_70px_var(--shadow)] md:p-8">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--sky)]">
              Shared subscription
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">
              Continual Pro for EMWaver
            </h1>
            <p className="mt-4 max-w-3xl text-[15px] leading-7 text-[color:var(--ink-dim)]">
              Continual Pro unlocks EMWaver cloud access, higher Agent limits, and broader device coverage.
              Free access stays usable for local scripts and smaller monthly usage, while Pro expands the
              full hosted workflow.
            </p>

            <div className="mt-7 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--aqua)]">
                  Cloud
                </div>
                <div className="mt-2 text-base font-semibold text-[color:var(--ink)]">Remote hosts and sync</div>
                <p className="mt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
                  Keep files, sessions, and remote control features available from the web workspace.
                </p>
              </div>
              <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--sky)]">
                  Agent
                </div>
                <div className="mt-2 text-base font-semibold text-[color:var(--ink)]">Higher included usage</div>
                <p className="mt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
                  Expand monthly token allowance for more generation, hardware iteration, and testing loops.
                </p>
              </div>
              <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--copper)]">
                  Devices
                </div>
                <div className="mt-2 text-base font-semibold text-[color:var(--ink)]">Larger activation limits</div>
                <p className="mt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
                  Move beyond the small free-device cap when you need a broader working lab setup.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[2rem] border border-[color:var(--line)] bg-[color:var(--surface)] p-6 md:p-7">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-[color:var(--ink)]">Status</div>
              {entitlements?.pro ? (
                <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--aqua-tint-2)] px-3 py-1 text-xs font-semibold text-[color:var(--aqua)]">
                  Continual Pro active
                </div>
              ) : (
                <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface-2)] px-3 py-1 text-xs font-semibold text-[color:var(--ink-dim)]">
                  Free access
                </div>
              )}
            </div>

            <div className="mt-5 space-y-4 text-sm text-[color:var(--ink-dim)]">
              <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface-3)] px-4 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-dim)]">
                  Account
                </div>
                <div className="mt-2 text-base font-semibold text-[color:var(--ink)]">
                  {userEmail ? userEmail : "Not signed in"}
                </div>
              </div>

              <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface-3)] px-4 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-dim)]">
                  Agent credits
                </div>
                <div className="mt-2 text-base font-semibold text-[color:var(--ink)]">
                  {idToken ? (
                    credits ? (
                      `${credits.balance} available${credits.monthlyAllowance ? ` / ${credits.monthlyAllowance} per month` : ""}`
                    ) : (
                      "Coming soon"
                    )
                  ) : (
                    "Sign in to view balance"
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-2">
              <button
                disabled={busy || !!entitlements?.pro}
                onClick={() => void startProCheckout()}
                className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-3 text-sm font-semibold text-[color:var(--paper)] hover:opacity-95 disabled:opacity-50"
              >
                {entitlements?.pro ? "You already have Continual Pro" : idToken ? "Get Continual Pro" : "Sign in to get Continual Pro"}
              </button>

              <button
                disabled={busy}
                onClick={() => void openPortal()}
                className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-4 py-3 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-3)] disabled:opacity-50"
              >
                Manage subscription
              </button>
            </div>

            <p className="mt-4 text-sm leading-6 text-[color:var(--ink-dim)]">
              Continual Pro is the shared paid plan direction across Continual MI products, with EMWaver using it for cloud access and expanded usage.
            </p>
          </div>
        </section>

        <section className="mt-6 rounded-[2rem] border border-[color:var(--line)] bg-[color:var(--surface-3)] p-6 md:p-8">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--aqua)]">
                Plan comparison
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--ink)]">
                Free vs Continual Pro
              </h2>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-[color:var(--ink-dim)]">
              Free keeps the local scripting flow available. Continual Pro adds the hosted and higher-volume workflow around it.
            </p>
          </div>

          <div className="mt-5 overflow-x-auto rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[color:var(--surface-2)] text-[color:var(--ink)]">
                <tr>
                  <th className="px-3 py-2 font-semibold">Feature</th>
                  <th className="px-3 py-2 font-semibold">Free</th>
                  <th className="px-3 py-2 font-semibold">Continual Pro</th>
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
        </section>

        {error ? <div className="mt-4 whitespace-pre-wrap text-xs text-red-300">{error}</div> : null}
      </main>
    </div>
  );
}
