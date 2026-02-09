import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import React, { useMemo, useState } from 'react';

type DfuInfo = {
  interface_number: number;
  alt_settings: { setting_number: number; description?: string | null }[];
  selected_alt_setting?: number | null;
};

type DeviceMintResult = {
  device_id_b64: string;
  proof_b64: string;
  algorithm: string;
  device_id_len: number;
  proof_len: number;
};

type ProvisionResult = {
  identity_page_addr: number;
  firmware_path: string;
  wrote_identity: boolean;
};

type AuthSession = {
  id_token: string;
  refresh_token: string;
  email?: string | null;
  display_name?: string | null;
  uid?: string | null;
};

export default function App() {
  const productionBackend = 'https://emwaver-backend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io';
  const localBackend = 'http://localhost:8787';

  const [status, setStatus] = useState<string>('Idle');
  const [dfuInfo, setDfuInfo] = useState<DfuInfo | null>(null);
  const [firmwarePath, setFirmwarePath] = useState<string | null>(null);
  const [minted, setMinted] = useState<DeviceMintResult | null>(null);
  const [provisionResult, setProvisionResult] = useState<ProvisionResult | null>(null);

  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  type BackendMode = 'production' | 'local';
  const [backendMode, setBackendMode] = useState<BackendMode>(() => {
    try {
      // Mirror desktop keys.
      return localStorage.getItem('emwaver.backend.useProduction') === '1' ? 'production' : 'local';
    } catch {
      return 'production';
    }
  });

  const backendUrl = useMemo(() => {
    return backendMode === 'production' ? productionBackend : localBackend;
  }, [backendMode]);

  const [session, setSession] = useState<AuthSession | null>(() => {
    try {
      const raw = localStorage.getItem('securewaver.auth.session');
      return raw ? (JSON.parse(raw) as AuthSession) : null;
    } catch {
      return null;
    }
  });

  const signedInLabel = useMemo(() => {
    if (!session) return 'Not signed in';
    return session.display_name || session.email || session.uid || 'Signed in';
  }, [session]);

  async function tryRestore() {
    if (!session?.refresh_token) return;
    try {
      setStatus('Restoring session…');
      const s = await invoke<AuthSession>('auth_firebase_refresh', { refresh_token: session.refresh_token });
      const merged: AuthSession = { ...session, ...s, email: session.email, display_name: session.display_name };
      setSession(merged);
      try { localStorage.setItem('securewaver.auth.session', JSON.stringify(merged)); } catch {}
      setStatus('Signed in');
    } catch (e: any) {
      setStatus(`Session restore failed: ${e}`);
      setSession(null);
      try { localStorage.removeItem('securewaver.auth.session'); } catch {}
    }
  }

  React.useEffect(() => {
    if (session?.refresh_token) void tryRestore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function probe() {
    setStatus('Probing DFU…');
    setDfuInfo(null);
    try {
      const info = await invoke<DfuInfo>('dfu_probe');
      setDfuInfo(info);
      setStatus('DFU device found');
    } catch (e: any) {
      setStatus(`DFU probe failed: ${e}`);
    }
  }

  async function loginGoogle() {
    setStatus('Signing in with Google…');
    try {
      const s = await invoke<AuthSession>('auth_google_sign_in');
      setSession(s);
      try { localStorage.setItem('securewaver.auth.session', JSON.stringify(s)); } catch {}
      setStatus('Signed in');
    } catch (e: any) {
      setStatus(`Sign-in failed: ${e}`);
    }
  }

  function logout() {
    setSession(null);
    try { localStorage.removeItem('securewaver.auth.session'); } catch {}
    setStatus('Signed out');
  }

  async function selectFirmware() {
    const picked = await open({ title: 'Select firmware (.bin)', multiple: false });
    if (!picked || Array.isArray(picked)) return;
    setFirmwarePath(picked);
    setStatus('Firmware selected');
  }

  async function mintFromBackend(idToken: string): Promise<DeviceMintResult> {
    const url = `${backendUrl.replace(/\/$/, '')}/provisioning/mint`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`
      }
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Backend mint failed (${res.status}): ${txt}`);
    }
    return (await res.json()) as DeviceMintResult;
  }

  async function mintAndProvision() {
    setProvisionResult(null);
    setMinted(null);

    if (!session?.id_token) {
      setStatus('Missing login');
      return;
    }
    if (!firmwarePath) {
      setStatus('Missing firmware file');
      return;
    }

    try {
      setStatus('Requesting DeviceID+Proof from backend…');
      const m = await mintFromBackend(session.id_token);
      setMinted(m);

      setStatus('Provisioning via DFU (flash firmware + identity)…');
      const pr = await invoke<ProvisionResult>('dfu_provision_device', {
        firmwarePath,
        deviceIdB64: m.device_id_b64,
        proofB64: m.proof_b64
      });
      setProvisionResult(pr);
      setStatus('Provisioning complete');
    } catch (e: any) {
      setStatus(`Provisioning failed: ${e}`);
    }
  }

  const canProvision = !!session?.id_token && !!firmwarePath;

  return (
    <div className="sw-wrap">
      <div className="sw-topbar">
        <div className="sw-title">
          <h1>SecureWaver</h1>
          <p>Provisioning (mint DeviceID+Proof from backend, then DFU flash).</p>
        </div>

        <div className="sw-row">
          <span className="sw-pill">
            <span style={{ width: 8, height: 8, borderRadius: 99, background: session ? 'var(--aqua)' : 'rgba(233,238,252,0.25)' }} />
            {signedInLabel}
          </span>
          <button className="sw-btn" onClick={() => setSettingsOpen((v) => !v)}>
            Settings
          </button>
          {!session ? (
            <button className="sw-btn sw-btn-primary" onClick={loginGoogle}>
              Sign in
            </button>
          ) : (
            <button className="sw-btn sw-btn-danger" onClick={logout}>
              Sign out
            </button>
          )}
        </div>
      </div>

      <div className={status.toLowerCase().includes('failed') ? 'sw-banner error' : 'sw-banner'}>
        <strong>Status:</strong> {status}
      </div>

      <div style={{ height: 12 }} />

      <div className="sw-grid">
        <div className="sw-card">
          <div className="sw-card-h">
            <h2>Provision</h2>
            <div className="sub">Mint identity on backend then flash firmware + identity page over DFU.</div>
          </div>
          <div className="sw-card-b">
            <div className="sw-row">
              <button className="sw-btn" onClick={selectFirmware}>Select firmware</button>
              <button className="sw-btn" onClick={probe}>Probe DFU</button>
              <button className="sw-btn sw-btn-primary" onClick={mintAndProvision} disabled={!canProvision}>
                Mint + Provision
              </button>
            </div>

            <div style={{ height: 12 }} />

            <div className="sw-kv">
              <div>Backend</div>
              <div><code>{backendUrl}</code></div>
              <div>Firmware</div>
              <div><code>{firmwarePath ?? '(not selected)'}</code></div>
            </div>

            {settingsOpen && (
              <div style={{ marginTop: 14 }} className="sw-banner">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <strong>Backend settings</strong>
                  <button className="sw-btn" onClick={() => setSettingsOpen(false)}>Close</button>
                </div>

                <div style={{ height: 10 }} />

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      className={`sw-btn ${backendMode === 'production' ? 'sw-btn-primary' : ''}`}
                      onClick={() => {
                        setBackendMode('production');
                        try { localStorage.setItem('emwaver.backend.useProduction', '1'); } catch {}
                      }}
                    >
                      Production (Azure)
                    </button>
                    <button
                      className={`sw-btn ${backendMode === 'local' ? 'sw-btn-primary' : ''}`}
                      onClick={() => {
                        setBackendMode('local');
                        try { localStorage.setItem('emwaver.backend.useProduction', '0'); } catch {}
                      }}
                    >
                      Local
                    </button>
                  </div>

                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-dim)' }}>
                  Current: <code>{backendUrl}</code>
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-dim)' }}>
                  Local is fixed to <code>{localBackend}</code>.
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-dim)' }}>
                  Production is <code>{productionBackend}</code>.
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="sw-card">
          <div className="sw-card-h">
            <h2>Results</h2>
            <div className="sub">Minted identity + DFU discovery + provision output.</div>
          </div>
          <div className="sw-card-b">
            {minted && (
              <>
                <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginBottom: 6 }}>Minted identity</div>
                <pre className="sw-pre">{JSON.stringify(minted, null, 2)}</pre>
                <div style={{ height: 10 }} />
              </>
            )}

            {provisionResult && (
              <>
                <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginBottom: 6 }}>Provision result</div>
                <pre className="sw-pre">{JSON.stringify(provisionResult, null, 2)}</pre>
                <div style={{ height: 10 }} />
              </>
            )}

            {dfuInfo && (
              <>
                <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginBottom: 6 }}>DFU discovery</div>
                <pre className="sw-pre">{JSON.stringify(dfuInfo, null, 2)}</pre>
              </>
            )}

            {!minted && !provisionResult && !dfuInfo && (
              <div style={{ fontSize: 12, color: 'var(--ink-dim)' }}>
                No output yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
