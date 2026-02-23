"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { createCheckoutSession } from "@/lib/store";
import { firebaseAuth, googleProvider, isFirebaseConfigured } from "@/lib/firebase";

function isValidEmail(s: string): boolean {
  const v = (s || "").trim();
  return v.includes("@") && v.includes(".") && v.length >= 6;
}

export default function OrderPage() {
  const auth = useMemo(() => (isFirebaseConfigured() ? firebaseAuth() : null), []);

  const [email, setEmail] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(1);

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [idToken, setIdToken] = useState<string>("");

  const [phase, setPhase] = useState<"email" | "options">("email");
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setUserEmail(null);
        setIdToken("");
        return;
      }
      setUserEmail(u.email || u.displayName || "Signed in");
      const tok = await u.getIdToken();
      setIdToken(tok);
      // If user signs in and email field is empty, default it.
      if (!email && u.email) setEmail(u.email);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  async function doSignIn() {
    setError(null);
    if (!auth) {
      setError(
        "Google sign-in is not configured yet (missing NEXT_PUBLIC_FIREBASE_* env). You can still checkout as guest." 
      );
      return;
    }
    try {
      await signInWithPopup(auth, googleProvider());
    } catch (e: any) {
      const code = e?.code ? String(e.code) : "";
      const msg = e?.message ? String(e.message) : String(e);
      setError(code ? `${code}: ${msg}` : msg);
    }
  }

  async function doSignOut() {
    setError(null);
    if (!auth) return;
    await signOut(auth);
  }

  async function startCheckout(mode: "guest" | "account") {
    setError(null);
    if (!isValidEmail(email)) {
      setError("Please enter a valid email.");
      return;
    }
    if (mode === "account" && !idToken) {
      setError("Please sign in first (or choose guest checkout).");
      return;
    }

    setBusy(true);
    try {
      const r = await createCheckoutSession({ email: email.trim(), quantity, idToken: mode === "account" ? idToken : "" });
      if (!r.url) throw new Error("Missing Stripe Checkout URL");
      window.location.href = r.url;
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell-fixed docs-mode">
      <SiteHeader />
      <main className="app-shell-main w-full px-5 py-10">
        <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-6 md:p-10">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">Buy EMWaver</h1>
              <p className="pt-3 max-w-2xl text-[15px] leading-7 text-[color:var(--ink-dim)]">
                Single-product checkout. Enter your email first, then choose guest checkout or sign in with Google to keep your orders tied to your EMWaver account.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <a
                href="/device"
                className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                Device
              </a>
              <a
                href="/pinout"
                className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                Pinout
              </a>
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
              <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">What ships</div>
              <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">One board + apps</div>
              <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Script-first exploration on mobile + desktop.</div>
            </div>

            <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(78,231,199,0.08)] p-5">
              <div className="text-xs font-semibold tracking-wide text-[color:var(--aqua)]">Accounts</div>
              <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">Optional Google sign-in</div>
              <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Sign in to attach devices to your account and manage Pro (cloud features are Pro-only).</div>
            </div>

            <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(240,166,106,0.10)] p-5">
              <div className="text-xs font-semibold tracking-wide text-[color:var(--copper)]">Shipping</div>
              <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">Worldwide (configurable)</div>
              <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Final rates and regions will be enabled when sales open.</div>
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-3xl border border-[color:var(--line)] bg-[color:var(--surface)] p-6">
              <div className="text-sm font-semibold text-[color:var(--ink)]">Checkout</div>

              {phase === "email" ? (
                <div className="mt-4 space-y-3">
                  <label className="block">
                    <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Email</div>
                    <input
                      value={email}
                      onChange={(e) => setEmail(String(e.target.value || ""))}
                      placeholder="you@domain.com"
                      className="mt-2 w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-3 py-2 text-sm text-[color:var(--ink)]"
                    />
                  </label>

                  <label className="block">
                    <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Quantity</div>
                    <select
                      value={quantity}
                      onChange={(e) => setQuantity(Math.max(1, Math.min(5, parseInt(String(e.target.value || "1"), 10) || 1)))}
                      className="mt-2 w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-3 py-2 text-sm text-[color:var(--ink)]"
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      if (!isValidEmail(email)) {
                        setError("Please enter a valid email.");
                        return;
                      }
                      setPhase("options");
                    }}
                    className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] hover:opacity-95 disabled:opacity-50"
                  >
                    Continue
                  </button>

                  <div className="text-xs text-[color:var(--ink-dim)]">
                    We’ll use this email for receipts and shipping updates.
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.02)] p-4">
                    <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Email</div>
                    <div className="pt-1 text-sm font-semibold text-[color:var(--ink)]">{email.trim()}</div>
                    <button
                      disabled={busy}
                      onClick={() => setPhase("email")}
                      className="mt-2 text-xs font-semibold text-[color:var(--aqua)] hover:underline disabled:opacity-50"
                    >
                      Change
                    </button>
                  </div>

                  <div className="grid gap-2">
                    <button
                      disabled={busy}
                      onClick={() => void startCheckout("guest")}
                      className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-3)] disabled:opacity-50"
                    >
                      Checkout as guest
                    </button>

                    <button
                      disabled={busy}
                      onClick={() => void (idToken ? startCheckout("account") : doSignIn())}
                      className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] hover:opacity-95 disabled:opacity-50"
                      title={idToken ? "Checkout with account" : "Sign in with Google"}
                    >
                      {idToken ? "Checkout with EMWaver account" : "Sign in with Google"}
                    </button>
                  </div>

                  {userEmail ? (
                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[color:var(--line)] bg-[rgba(78,231,199,0.06)] p-4">
                      <div>
                        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Signed in</div>
                        <div className="pt-1 text-sm font-semibold text-[color:var(--ink)]">{userEmail}</div>
                      </div>
                      <button
                        onClick={() => void doSignOut()}
                        disabled={busy}
                        className="rounded-lg border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1.5 text-xs font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)] disabled:opacity-50"
                      >
                        Log out
                      </button>
                    </div>
                  ) : (
                    <div className="text-xs text-[color:var(--ink-dim)]">
                      Signing in is optional, but recommended if you want order history + recovery.
                    </div>
                  )}
                </div>
              )}

              {error ? <div className="mt-4 whitespace-pre-wrap text-xs text-red-300">{error}</div> : null}

              <div className="mt-6 text-xs text-[color:var(--ink-dim)]">
                Note: purchases are not open yet. This flow is being built ahead of CE certification.
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-[color:var(--line)] bg-[color:var(--surface)] shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
              <img src="/EMWAVER.jpg" alt="EMWaver device" className="h-auto w-full object-cover" />
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
