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
  const [status, setStatus] = useState<string>('Idle');
  const [dfuInfo, setDfuInfo] = useState<DfuInfo | null>(null);
  const [firmwarePath, setFirmwarePath] = useState<string | null>(null);
  const [minted, setMinted] = useState<DeviceMintResult | null>(null);
  const [provisionResult, setProvisionResult] = useState<ProvisionResult | null>(null);
  const [session, setSession] = useState<AuthSession | null>(() => {
    try {
      const raw = localStorage.getItem('securewaver.auth.session');
      return raw ? (JSON.parse(raw) as AuthSession) : null;
    } catch {
      return null;
    }
  });

  const productionBackend = 'https://emwaver-backend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io';

  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [useProductionBackend, setUseProductionBackend] = useState<boolean>(() => {
    try {
      return localStorage.getItem('emwaver.backend.useProduction') === '1';
    } catch {
      return false;
    }
  });
  const [localBackendUrl, setLocalBackendUrl] = useState<string>(() => {
    try {
      return localStorage.getItem('emwaver.backend.localURL') || '';
    } catch {
      return '';
    }
  });

  const backendUrl = useMemo(() => {
    if (useProductionBackend) return productionBackend;
    const trimmed = localBackendUrl.trim();
    if (trimmed) return trimmed;
    return productionBackend;
  }, [useProductionBackend, localBackendUrl]);

  const userLabel = useMemo(() => {
    if (!session) return '(not signed in)';
    return session.display_name || session.email || session.uid || '(signed in)';
  }, [session]);

  // Best-effort restore on first render.
  React.useEffect(() => {
    if (session?.refresh_token) {
      // don't block initial render
      void tryRestore();
    }
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
    setStatus('Signing in with Google (system browser)…');
    try {
      const s = await invoke<AuthSession>('auth_google_sign_in');
      setSession(s);
      try { localStorage.setItem('securewaver.auth.session', JSON.stringify(s)); } catch {}
      setStatus('Signed in');
    } catch (e: any) {
      setStatus(`Sign-in failed: ${e}`);
    }
  }

  async function tryRestore() {
    if (!session?.refresh_token) return;
    try {
      setStatus('Restoring session…');
      const s = await invoke<AuthSession>('auth_firebase_refresh', { refresh_token: session.refresh_token });
      // keep original email/display_name if we had them
      const merged: AuthSession = { ...session, ...s, email: session.email, display_name: session.display_name };
      setSession(merged);
      try { localStorage.setItem('securewaver.auth.session', JSON.stringify(merged)); } catch {}
      setStatus('Signed in');
    } catch (e: any) {
      // leave user signed out if refresh fails
      setStatus(`Session restore failed: ${e}`);
      setSession(null);
      try { localStorage.removeItem('securewaver.auth.session'); } catch {}
    }
  }

  function logout() {
    setSession(null);
    try { localStorage.removeItem('securewaver.auth.session'); } catch {}
    setStatus('Signed out');
  }

  async function selectFirmware() {
    const picked = await open({
      title: 'Select firmware (.bin)',
      multiple: false
    });
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

  return (
    <div style={{ fontFamily: 'system-ui', padding: 16, maxWidth: 980 }}>
      <h1 style={{ marginTop: 0 }}>SecureWaver</h1>
      <p style={{ color: '#555' }}>
        Internal provisioning tool (Google OAuth PKCE + Firebase ID token + backend mint + DFU flash).
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {!session ? (
          <button onClick={loginGoogle}>Sign in with Google…</button>
        ) : (
          <button onClick={logout}>Sign out</button>
        )}

        <button onClick={() => setSettingsOpen((v) => !v)}>Settings…</button>
        <button onClick={selectFirmware}>Select firmware…</button>
        <button onClick={probe}>Probe DFU device</button>
        <button onClick={mintAndProvision}>Mint (backend) + Provision (DFU)</button>

        <div>
          <b>Status:</b> {status}
        </div>
      </div>

      <div style={{ marginTop: 10, color: '#555' }}>
        <div>
          <b>Signed in:</b> {userLabel}
        </div>
        <div>
          <b>Backend:</b> {backendUrl}
        </div>
        <div>
          <b>Firmware:</b> {firmwarePath ?? '(not selected)'}
        </div>
      </div>

      {settingsOpen && (
        <div style={{ marginTop: 16, padding: 12, background: '#f6f6f6', borderRadius: 8 }}>
          <h2 style={{ marginTop: 0 }}>Settings</h2>

          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={useProductionBackend}
              onChange={(e) => {
                const v = e.target.checked;
                setUseProductionBackend(v);
                try { localStorage.setItem('emwaver.backend.useProduction', v ? '1' : '0'); } catch {}
              }}
            />
            Use production backend (Azure)
          </label>

          {!useProductionBackend && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, color: '#555', marginBottom: 6 }}>Local backend URL</div>
              <input
                value={localBackendUrl}
                onChange={(e) => {
                  const v = e.target.value;
                  setLocalBackendUrl(v);
                  try { localStorage.setItem('emwaver.backend.localURL', v); } catch {}
                }}
                placeholder="http://localhost:8787"
                style={{ width: 520 }}
              />
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: 12, color: '#555' }}>
            Production: {productionBackend}
          </div>

          <div style={{ marginTop: 12 }}>
            <button onClick={() => setSettingsOpen(false)}>Close settings</button>
          </div>
        </div>
      )}

      {minted && (
        <div style={{ marginTop: 16 }}>
          <h2>Minted identity</h2>
          <pre style={{ background: '#f6f6f6', padding: 12, borderRadius: 8, overflowX: 'auto' }}>
            {JSON.stringify(minted, null, 2)}
          </pre>
        </div>
      )}

      {provisionResult && (
        <div style={{ marginTop: 16 }}>
          <h2>Provision result</h2>
          <pre style={{ background: '#f6f6f6', padding: 12, borderRadius: 8, overflowX: 'auto' }}>
            {JSON.stringify(provisionResult, null, 2)}
          </pre>
        </div>
      )}

      {dfuInfo && (
        <div style={{ marginTop: 16 }}>
          <h2>DFU Discovery</h2>
          <pre style={{ background: '#f6f6f6', padding: 12, borderRadius: 8, overflowX: 'auto' }}>
            {JSON.stringify(dfuInfo, null, 2)}
          </pre>
        </div>
      )}

      <hr style={{ margin: '24px 0' }} />
      <h2>Required env vars (SecureWaver)</h2>
      <ul>
        <li><code>EMWAVER_GOOGLE_CLIENT_ID</code></li>
        <li><code>EMWAVER_GOOGLE_CLIENT_SECRET</code> (optional)</li>
        <li><code>EMWAVER_FIREBASE_WEB_API_KEY</code></li>
        <li><code>VITE_BACKEND_URL</code> (optional)</li>
      </ul>
    </div>
  );
}
