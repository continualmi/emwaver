"use client";

import { useEffect, useState } from "react";

import { EmwAuthGoogleButton } from "@/components/EmwAuthGoogleButton";
import { backendFetch } from "@/lib/backend";
import { fetchSessionState, redirectToContinualSignIn, signOutSession } from "@/lib/clientSession";

type Entitlements = {
  pro: boolean;
  expires_at_ms?: number | null;
  features?: { [k: string]: boolean };
};

type KeyStatus = {
  exists: boolean;
  keyPrefix: string | null;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  lastUsedAtMs: number | null;
  revokedAtMs: number | null;
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

async function fetchApiKeyStatus(): Promise<KeyStatus> {
  const res = await fetch("/api/auth/key", { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  const json = JSON.parse(text) as { key?: KeyStatus };
  return json.key ?? {
    exists: false,
    keyPrefix: null,
    createdAtMs: null,
    updatedAtMs: null,
    lastUsedAtMs: null,
    revokedAtMs: null,
  };
}

async function createApiKey(): Promise<{ apiKey: string; key: KeyStatus }> {
  const res = await fetch("/api/auth/key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  const json = JSON.parse(text) as { api_key?: string; key?: KeyStatus };
  return {
    apiKey: typeof json.api_key === "string" ? json.api_key : "",
    key: json.key ?? {
      exists: false,
      keyPrefix: null,
      createdAtMs: null,
      updatedAtMs: null,
      lastUsedAtMs: null,
      revokedAtMs: null,
    },
  };
}

async function revokeApiKey() {
  const res = await fetch("/api/auth/key", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
}

export function AccountPanel() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [idToken, setIdToken] = useState<string>("");
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [apiKeyStatus, setApiKeyStatus] = useState<KeyStatus | null>(null);
  const [freshApiKey, setFreshApiKey] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setError(null);
      const session = await fetchSessionState();
      if (!session.user) {
        setUserEmail(null);
        setIdToken("");
        setEntitlements(null);
        setApiKeyStatus(null);
        setFreshApiKey("");
        return;
      }
      setUserEmail(session.user.email || session.user.name || "Signed in");
      const tok = session.accessToken;
      setIdToken(tok);
      try {
        const [nextEntitlements, nextKeyStatus] = await Promise.all([
          getEntitlements(tok),
          fetchApiKeyStatus(),
        ]);
        setEntitlements(nextEntitlements);
        setApiKeyStatus(nextKeyStatus);
      } catch (nextError: unknown) {
        setError(errorMessage(nextError));
      }
    })();
  }, []);

  async function doSignIn() {
    redirectToContinualSignIn("/account");
  }

  async function doSignOut() {
    setError(null);
    setBusy(true);
    try {
      await signOutSession();
      setUserEmail(null);
      setIdToken("");
      setEntitlements(null);
      setApiKeyStatus(null);
      setFreshApiKey("");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (!idToken) return;
    setBusy(true);
    setError(null);
    try {
      const [nextEntitlements, nextKeyStatus] = await Promise.all([
        getEntitlements(idToken),
        fetchApiKeyStatus(),
      ]);
      setEntitlements(nextEntitlements);
      setApiKeyStatus(nextKeyStatus);
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

  async function doCreateApiKey() {
    setBusy(true);
    setError(null);
    try {
      const next = await createApiKey();
      setFreshApiKey(next.apiKey);
      setApiKeyStatus(next.key);
    } catch (nextError: unknown) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function doRevokeApiKey() {
    setBusy(true);
    setError(null);
    try {
      await revokeApiKey();
      setFreshApiKey("");
      setApiKeyStatus({
        exists: false,
        keyPrefix: null,
        createdAtMs: null,
        updatedAtMs: null,
        lastUsedAtMs: null,
        revokedAtMs: null,
      });
    } catch (nextError: unknown) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--ink)]">Account</h2>
          <div className="pt-1 text-sm text-[color:var(--ink-dim)]">Devices, orders, and Continual Pro</div>
          {entitlements?.pro ? (
            <div className="mt-2 inline-flex items-center rounded-full border border-[color:var(--line)] bg-[color:var(--aqua-tint-2)] px-3 py-1 text-xs font-semibold text-[color:var(--aqua)]">
              Continual Pro active
            </div>
          ) : null}
        </div>

        {!userEmail ? (
          <EmwAuthGoogleButton
            busy={busy}
            label="Continue with Google"
            busyLabel="Opening Google..."
            className="min-w-[16rem]"
            onClick={() => void doSignIn()}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-[color:var(--ink-dim)]">{userEmail}</div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void doManagePro()}
              className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)] disabled:opacity-50"
            >
              Manage Continual Pro
            </button>
            <a
              href="/account"
              className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
            >
              Manage API key
            </a>
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
          <div className="text-sm font-semibold text-[color:var(--ink)]">Sign in for optional services</div>
          <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
            Devices can be used locally without an account. Sign in only for optional Agent, API-key, account, and hosted-service features.
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
              Local hardware control does not require this account. Account state is only for optional Agent/API-key and hosted-service features.
            </div>
            <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] p-4">
              Native apps now use a single EMWaver API key that you create here on the web and paste into the app.
            </div>
            <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-[color:var(--ink)]">EMWaver app key</div>
                  <div className="pt-1 text-xs text-[color:var(--ink-dim)]">
                    Use this key for optional Agent/account services in EMWaver apps. It should not gate local script execution.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void doCreateApiKey()}
                    disabled={busy}
                    className="rounded-lg bg-[color:var(--ink)] px-3 py-1.5 text-xs font-semibold text-[color:var(--paper)] disabled:opacity-50"
                  >
                    {apiKeyStatus?.exists ? "Replace key" : "Create key"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void doRevokeApiKey()}
                    disabled={busy || !apiKeyStatus?.exists}
                    className="rounded-lg border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1.5 text-xs font-semibold text-[color:var(--ink)] disabled:opacity-50"
                  >
                    Revoke key
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-2 text-xs text-[color:var(--ink-dim)]">
                <div>
                  Status: {apiKeyStatus?.exists ? `active (${apiKeyStatus.keyPrefix || "EMW key"})` : "no key created yet"}
                </div>
                {apiKeyStatus?.createdAtMs ? (
                  <div>Created: {new Date(apiKeyStatus.createdAtMs).toLocaleString()}</div>
                ) : null}
                {apiKeyStatus?.lastUsedAtMs ? (
                  <div>Last used: {new Date(apiKeyStatus.lastUsedAtMs).toLocaleString()}</div>
                ) : null}
              </div>

              {freshApiKey ? (
                <div className="mt-4 rounded-xl border border-[color:var(--line)] bg-[color:var(--paper)] p-4">
                  <div className="text-xs font-semibold text-[color:var(--ink)]">Copy this key now</div>
                  <div className="pt-1 text-xs text-[color:var(--ink-dim)]">
                    This is the full key value. Treat it like a password for your EMWaver apps.
                  </div>
                  <div className="mt-3 rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-2)] p-3 font-mono text-xs text-[color:var(--ink)] break-all">
                    {freshApiKey}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      )}

      {error ? <div className="whitespace-pre-wrap text-xs text-red-300">{error}</div> : null}
    </div>
  );
}
