"use client";

import { signInWithPopup } from "firebase/auth";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { SiteHeader } from "@/components/SiteHeader";
import { firebaseAuth, googleProvider, isFirebaseConfigured } from "@/lib/firebase";

function normalizeRedirect(raw: string | null) {
  if (!raw) return "/cloud";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/cloud";
}

export default function SignInClient() {
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const redirectPath = useMemo(() => normalizeRedirect(params.get("redirect")), [params]);

  async function handleSignIn() {
    setBusy(true);
    setError(null);

    try {
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

      window.location.assign(redirectPath);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to complete sign-in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh docs-mode">
      <SiteHeader />
      <main className="w-full overflow-y-auto px-5 py-10">
        <div className="rounded-3xl border border-[color:var(--line)] bg-[color:var(--surface-3)] p-6 md:p-10">
          <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">Sign in with Continual</h1>
          <p className="pt-3 text-[15px] leading-7 text-[color:var(--ink-dim)]">
            EMWaver now uses your shared Continual account for sign-in and subscription access.
          </p>

          <div className="mt-6 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
            <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">Continue</div>
            <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
              Sign in directly with EMWaver using your Continual Google account, then return to EMWaver.
            </div>

            {error ? <div className="mt-4 text-sm text-red-400">{error}</div> : null}

            <div className="mt-4">
              <button
                type="button"
                onClick={() => void handleSignIn()}
                disabled={busy || !isFirebaseConfigured()}
                className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] hover:opacity-95"
              >
                {busy ? "Signing in..." : "Continue with Google"}
              </button>
            </div>

            <div className="pt-5 text-xs text-[color:var(--ink-dim)]">After sign-in you’ll be redirected to {redirectPath}.</div>
          </div>
        </div>
      </main>
    </div>
  );
}
