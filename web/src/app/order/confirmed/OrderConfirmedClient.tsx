"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { onAuthStateChanged, signInWithPopup } from "firebase/auth";

import { SiteHeader } from "@/components/SiteHeader";
import { claimOrder } from "@/lib/store";
import { firebaseAuth, googleProvider, isFirebaseConfigured } from "@/lib/firebase";

export default function OrderConfirmedClient() {
  const params = useSearchParams();
  const sessionId = String(params.get("session_id") || "");

  const auth = useMemo(() => (isFirebaseConfigured() ? firebaseAuth() : null), []);
  const [idToken, setIdToken] = useState<string>("");
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [status, setStatus] = useState<"idle" | "claiming" | "claimed" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setIdToken("");
        setUserEmail(null);
        return;
      }
      setUserEmail(u.email || u.displayName || "Signed in");
      setIdToken(await u.getIdToken());
    });
  }, [auth]);

  async function doSignInAndClaim() {
    setError(null);
    if (!sessionId) {
      setError("Missing session_id.");
      return;
    }
    if (!auth) {
      setError("Google sign-in is not configured yet (missing NEXT_PUBLIC_FIREBASE_* env).");
      return;
    }

    try {
      if (!idToken) {
        await signInWithPopup(auth, googleProvider());
        // onAuthStateChanged will set idToken
        return;
      }

      setStatus("claiming");
      await claimOrder({ sessionId, idToken });
      setStatus("claimed");
    } catch (e: any) {
      setStatus("error");
      setError(String(e?.message || e));
    }
  }

  // If user becomes signed-in and we have a session id, auto-claim once.
  useEffect(() => {
    if (!sessionId) return;
    if (!idToken) return;
    if (status !== "idle") return;

    (async () => {
      try {
        setStatus("claiming");
        await claimOrder({ sessionId, idToken });
        setStatus("claimed");
      } catch (e: any) {
        setStatus("error");
        setError(String(e?.message || e));
      }
    })();
  }, [sessionId, idToken, status]);

  return (
    <div className="min-h-dvh docs-mode">
      <SiteHeader />
      <main className="w-full overflow-y-auto px-5 py-10">
        <div className="rounded-3xl border border-[color:var(--line)] bg-[color:var(--surface-3)] p-6 md:p-10">
          <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">
            Order confirmed
          </h1>
          <p className="pt-3 text-[15px] leading-7 text-[color:var(--ink-dim)]">
            If payment succeeded, you’ll receive a receipt from Stripe. You can optionally sign in to attach this
            purchase to your EMWaver account.
          </p>

          <div className="mt-6 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
            <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">Stripe session</div>
            <div className="pt-2 break-all font-mono text-xs text-[color:var(--ink)]">
              {sessionId || "(missing session_id)"}
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <button
              onClick={() => void doSignInAndClaim()}
              disabled={!sessionId || status === "claiming"}
              className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] hover:opacity-95 disabled:opacity-50"
            >
              {idToken ? "Attach purchase to my account" : "Sign in with Google to attach purchase"}
            </button>

            {userEmail ? <div className="text-xs text-[color:var(--ink-dim)]">Signed in as: {userEmail}</div> : null}

            {status === "claimed" ? (
              <div className="text-sm font-semibold text-[color:var(--aqua)]">Purchase attached to your account.</div>
            ) : null}

            {error ? <div className="whitespace-pre-wrap text-xs text-red-300">{error}</div> : null}

            <div className="pt-3 text-xs text-[color:var(--ink-dim)]">This is an early flow being built ahead of sales opening.</div>
          </div>
        </div>
      </main>
    </div>
  );
}
