"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged, signInWithPopup } from "firebase/auth";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { firebaseAuth, googleProvider, isFirebaseConfigured } from "@/lib/firebase";

type RedirectTarget =
  | { kind: "internal"; target: string }
  | { kind: "external"; target: string };

function normalizeRedirect(raw: string | null): RedirectTarget {
  if (!raw) return { kind: "internal", target: "/cloud" };

  // Allow same-site relative paths.
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    return { kind: "internal", target: raw };
  }

  // Allow strict native-app deep-link callback target used by Android handoff.
  try {
    const url = new URL(raw);
    if (url.protocol === "emwaver:" && url.hostname === "oauth" && url.pathname === "/callback") {
      return { kind: "external", target: raw };
    }
  } catch {
    // Invalid URL; fallback below.
  }

  return { kind: "internal", target: "/cloud" };
}

export default function SignInClient() {
  const params = useSearchParams();
  const router = useRouter();

  const redirectTo = useMemo(() => normalizeRedirect(params.get("redirect")), [params]);

  const auth = useMemo(() => (isFirebaseConfigured() ? firebaseAuth() : null), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (u) => {
      if (!u) {
        setUserEmail(null);
        return;
      }
      setUserEmail(u.email || u.displayName || "Signed in");
      // If already signed in, continue.
      if (redirectTo.kind === "external") {
        window.location.assign(redirectTo.target);
      } else {
        router.replace(redirectTo.target);
      }
    });
  }, [auth, router, redirectTo]);

  async function doSignIn() {
    setError(null);
    if (!auth) {
      setError("Google sign-in is not configured yet (missing NEXT_PUBLIC_FIREBASE_* env).");
      return;
    }

    try {
      setBusy(true);
      await signInWithPopup(auth, googleProvider());
      // onAuthStateChanged will redirect.
    } catch (e: any) {
      const code = e?.code ? String(e.code) : "";
      const msg = e?.message ? String(e.message) : String(e);
      setError(code ? `${code}: ${msg}` : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh docs-mode">
      <SiteHeader />
      <main className="w-full overflow-y-auto px-5 py-10">
        <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-6 md:p-10">
          <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">Sign in</h1>
          <p className="pt-3 text-[15px] leading-7 text-[color:var(--ink-dim)]">
            Sign in to access EMWaver cloud features and manage your account.
          </p>

          <div className="mt-6 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
            <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">Continue</div>
            <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
              {userEmail ? `Signed in as ${userEmail}` : "Use Google to continue."}
            </div>

            <div className="mt-4">
              <button
                onClick={() => void doSignIn()}
                disabled={busy}
                className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] hover:opacity-95 disabled:opacity-50"
              >
                {busy ? "Signing in…" : "Continue with Google"}
              </button>
            </div>

            {error ? <div className="mt-4 whitespace-pre-wrap text-xs text-red-300">{error}</div> : null}

            <div className="pt-5 text-xs text-[color:var(--ink-dim)]">After sign-in you’ll be redirected to {redirectTo.target}.</div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
