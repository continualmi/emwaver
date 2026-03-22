"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";

import { backendFetch } from "@/lib/backend";
import { firebaseAuth, googleProvider, isFirebaseConfigured } from "@/lib/firebase";

type Entitlements = {
  pro: boolean;
  expires_at_ms?: number | null;
  features?: { [k: string]: boolean };
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function getEntitlements(idToken: string): Promise<Entitlements> {
  const res = await backendFetch("/v1/entitlements", idToken, { method: "GET" });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return JSON.parse(text) as Entitlements;
}

async function openProPortal(idToken: string): Promise<string> {
  const res = await backendFetch("/v1/pro/portal", idToken, { method: "POST", body: "{}" });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  const json = JSON.parse(text);
  return String(json.url || "");
}

export function AccountPanel() {
  const auth = useMemo(() => (isFirebaseConfigured() ? firebaseAuth() : null), []);

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [idToken, setIdToken] = useState<string>("");
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      setError(null);
      if (!u) {
        setUserEmail(null);
        setIdToken("");
        setEntitlements(null);
        return;
      }
      setUserEmail(u.email || u.displayName || "Signed in");
      const tok = await u.getIdToken();
      setIdToken(tok);
      try {
        setEntitlements(await getEntitlements(tok));
      } catch (error: unknown) {
        setError(errorMessage(error));
      }
    });
  }, [auth]);

  async function doSignIn() {
    setError(null);
    if (!auth) {
      setError(
        "Firebase env is missing. Set NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_PROJECT_ID, NEXT_PUBLIC_FIREBASE_APP_ID"
      );
      return;
    }
    try {
      setBusy(true);
      await signInWithPopup(auth, googleProvider());
    } catch (error: unknown) {
      const maybeFirebaseError = error as { code?: string; message?: string };
      const code = maybeFirebaseError.code ? String(maybeFirebaseError.code) : "";
      const msg = maybeFirebaseError.message ? String(maybeFirebaseError.message) : String(error);
      setError(code ? `${code}: ${msg}` : msg);
    } finally {
      setBusy(false);
    }
  }

  async function doSignOut() {
    setError(null);
    if (!auth) return;
    setBusy(true);
    try {
      await signOut(auth);
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (!idToken) return;
    setBusy(true);
    setError(null);
    try {
      setEntitlements(await getEntitlements(idToken));
    } catch (error: unknown) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function doManagePro() {
    if (!idToken) return;
    setBusy(true);
    setError(null);
    try {
      const url = await openProPortal(idToken);
      if (!url) throw new Error("No portal URL returned.");
      window.location.href = url;
    } catch (error: unknown) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--ink)]">Account</h2>
          <div className="pt-1 text-sm text-[color:var(--ink-dim)]">Devices, orders, and Pro</div>
          {entitlements?.pro ? (
            <div className="mt-2 inline-flex items-center rounded-full border border-[color:var(--line)] bg-[color:var(--aqua-tint-2)] px-3 py-1 text-xs font-semibold text-[color:var(--aqua)]">
              Pro active
            </div>
          ) : null}
        </div>

        {!userEmail ? (
          <button
            type="button"
            onClick={() => void doSignIn()}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] hover:opacity-95 disabled:opacity-50"
          >
            {busy ? "Signing in..." : "Continue with Google"}
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-[color:var(--ink-dim)]">{userEmail}</div>
            <a
              href="/cloud"
              className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
            >
              Dashboard
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={() => void doManagePro()}
              className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)] disabled:opacity-50"
            >
              Manage Pro
            </button>
            <button
              type="button"
              onClick={() => void doSignOut()}
              disabled={busy}
              className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)] disabled:opacity-50"
            >
              Log out
            </button>
          </div>
        )}
      </div>

      {!userEmail ? (
        <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
          <div className="text-sm font-semibold text-[color:var(--ink)]">Sign in to manage devices</div>
          <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
            Devices can be used locally without an account, but signing in lets you keep activated devices tied to your account.
          </div>
        </div>
      ) : (
        <section className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-[color:var(--ink)]">Account overview</div>
              <div className="pt-1 text-xs text-[color:var(--ink-dim)]">Membership and connected-cloud status</div>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy}
              className="rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[color:var(--ink)] disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
          <div className="mt-4 space-y-3 text-sm text-[color:var(--ink-dim)]">
            <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] p-4">
              Activated devices now live on the Dashboard so you can see them alongside your cloud files and hosts.
            </div>
            <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] p-4">
              Use this modal for sign-in, session status, and Pro management.
            </div>
          </div>
        </section>
      )}

      {error ? <div className="whitespace-pre-wrap text-xs text-red-300">{error}</div> : null}
    </div>
  );
}
