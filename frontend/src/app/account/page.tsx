"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { backendFetch } from "@/lib/backend";
import { firebaseAuth, googleProvider, isFirebaseConfigured } from "@/lib/firebase";

type Entitlements = {
  pro: boolean;
  expires_at_ms?: number | null;
  features?: { [k: string]: boolean };
};

type Device = {
  device_id_b64: string;
  label?: string;
  created_at_ms?: number;
  updated_at_ms?: number;
  last_seen_at_ms?: number;
};

async function listMyDevices(idToken: string): Promise<Device[]> {
  const res = await backendFetch("/v1/devices/my", idToken, { method: "GET" });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  const json = JSON.parse(text);
  return json.devices || [];
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

async function setDeviceLabel(idToken: string, deviceIdB64: string, label: string) {
  const res = await backendFetch("/v1/devices/label", idToken, {
    method: "POST",
    body: JSON.stringify({ device_id_b64: deviceIdB64, label }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return JSON.parse(text) as { device: Device };
}

export default function AccountPage() {
  const auth = useMemo(() => (isFirebaseConfigured() ? firebaseAuth() : null), []);

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [idToken, setIdToken] = useState<string>("");

  const [devices, setDevices] = useState<Device[]>([]);
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
        setDevices([]);
        setEntitlements(null);
        return;
      }
      setUserEmail(u.email || u.displayName || "Signed in");
      const tok = await u.getIdToken();
      setIdToken(tok);
      // Load devices + entitlements.
      try {
        const [d, ent] = await Promise.all([listMyDevices(tok), getEntitlements(tok)]);
        setDevices(d);
        setEntitlements(ent);
      } catch (e: any) {
        setError(String(e?.message || e));
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

  async function refresh() {
    if (!idToken) return;
    setBusy(true);
    setError(null);
    try {
      const [d, ent] = await Promise.all([listMyDevices(idToken), getEntitlements(idToken)]);
      setDevices(d);
      setEntitlements(ent);
    } catch (e: any) {
      setError(String(e?.message || e));
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
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh">
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-5 pt-10 pb-14">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--ink)]">Account</h1>
            <div className="pt-1 text-sm text-[color:var(--ink-dim)]">Devices, orders, and recovery</div>
            {entitlements?.pro ? (
              <div className="mt-2 inline-flex items-center rounded-full border border-[color:var(--line)] bg-[rgba(78,231,199,0.10)] px-3 py-1 text-xs font-semibold text-[color:var(--aqua)]">
                Pro active
              </div>
            ) : null}
          </div>

          {!userEmail ? (
            <button
              onClick={() => void doSignIn()}
              className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] hover:opacity-95"
            >
              Sign in with Google
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <div className="text-sm text-[color:var(--ink-dim)]">{userEmail}</div>
              <a
                href="/cloud"
                className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                Dashboard
              </a>
              <button
                disabled={busy}
                onClick={() => void doManagePro()}
                className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)] disabled:opacity-50"
              >
                Manage Pro
              </button>
              <button
                onClick={() => void doSignOut()}
                className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
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
              Devices can be used locally without an account, but signing in lets you save them for recovery purposes.
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
            <section className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-[color:var(--ink)]">My devices</div>
                  <div className="pt-1 text-xs text-[color:var(--ink-dim)]">Attached SecureWaver identities</div>
                </div>
                <button
                  onClick={() => void refresh()}
                  disabled={busy}
                  className="rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[color:var(--ink)] disabled:opacity-50"
                >
                  Refresh
                </button>
              </div>

              {devices.length === 0 ? (
                <div className="pt-3 text-sm text-[color:var(--ink-dim)]">
                  No devices attached yet.
                  <div className="pt-2 text-xs">Tip: when the app detects a genuine device (DeviceID+Proof), it can prompt you to attach it here.</div>
                </div>
              ) : (
                <ul className="mt-4 space-y-3">
                  {devices.map((d) => (
                    <li key={d.device_id_b64} className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[color:var(--ink-dim)]">DeviceID</div>
                          <div className="mt-1 break-all font-mono text-xs text-[color:var(--ink)]">{d.device_id_b64}</div>
                          <div className="mt-3 text-xs font-semibold text-[color:var(--ink-dim)]">Label</div>
                          <input
                            defaultValue={d.label || ""}
                            placeholder="e.g. Lab board"
                            className="mt-1 w-full rounded-lg border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--ink)]"
                            onBlur={(e) => {
                              const next = String(e.target.value || "").trim();
                              void (async () => {
                                try {
                                  await setDeviceLabel(idToken, d.device_id_b64, next);
                                  await refresh();
                                } catch (err: any) {
                                  setError(String(err?.message || err));
                                }
                              })();
                            }}
                          />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
              <div className="text-sm font-semibold text-[color:var(--ink)]">Recovery</div>
              <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                This is where we’ll add “recovery mode” flows: re-attaching devices, resolving lost accounts, and validating genuine hardware ownership.
              </div>

              <div className="mt-4 rounded-xl border border-[color:var(--line)] bg-[rgba(240,166,106,0.10)] p-4">
                <div className="text-xs font-semibold tracking-wide text-[color:var(--copper)]">Planned</div>
                <ul className="mt-2 list-disc pl-5 text-sm text-[color:var(--ink-dim)]">
                  <li>Show connected devices and offer “Attach to account” if missing.</li>
                  <li>Recovery flow using device possession (DeviceID+Proof) + account sign-in.</li>
                  <li>Order-to-device association (optional, later).</li>
                </ul>
              </div>
            </section>
          </div>
        )}

        {error ? <div className="mt-4 whitespace-pre-wrap text-xs text-red-300">{error}</div> : null}
      </main>

      <SiteFooter />
    </div>
  );
}
