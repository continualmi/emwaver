import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import React, { useMemo, useState } from 'react';

type UpdateModeInfo = {
  interface_number: number;
  selected_alt_setting?: number | null;
};

type LegitCheckResult = {
  ok: boolean;
  transport: string;
  device_id_b64?: string | null;
  proof_b64?: string | null;
  details?: string[] | null;
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

type UpdatePreserveIdentityResult = {
  identity_page_addr: number;
  firmware_path: string;
  restored_identity: boolean;
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
  const [updateModeInfo, setUpdateModeInfo] = useState<UpdateModeInfo | null>(null);
  const [runModePorts, setRunModePorts] = useState<string[]>([]);
  const [legit, setLegit] = useState<LegitCheckResult | null>(null);
  const [useCustomFirmware, setUseCustomFirmware] = useState<boolean>(false);
  const [firmwarePath, setFirmwarePath] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [flashProgress, setFlashProgress] = useState<string | null>(null);
  const [flashPercent, setFlashPercent] = useState<number | null>(null);

  function log(line: string) {
    const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
    // Natural order: oldest at top, newest at bottom.
    setLogLines((prev) => [...prev, `${ts}  ${line}`].slice(-400));
  }

  type Page = 'main' | 'settings';
  const [page, setPage] = useState<Page>('main');
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

  const [session, setSession] = useState<AuthSession | null>(null);

  const signedInLabel = useMemo(() => {
    if (!session) return 'Not signed in';
    return session.display_name || session.email || session.uid || 'Signed in';
  }, [session]);

  async function loadSessionFromBackend() {
    try {
      const stored = await invoke<AuthSession | null>('auth_session_get');
      if (!stored) return;
      setSession(stored);
    } catch (e: any) {
      log(`Failed to load stored session: ${e}`);
    }
  }

  async function tryRestore(current: AuthSession) {
    if (!current?.refresh_token) return;
    try {
      setStatus('Restoring session…');
      const s = await invoke<AuthSession>('auth_firebase_refresh', { refreshToken: current.refresh_token });
      const merged: AuthSession = { ...current, ...s, email: current.email, display_name: current.display_name };
      setSession(merged);
      setStatus('Signed in');
      log('Session restored');
    } catch (e: any) {
      setStatus(`Session restore failed: ${e}`);
      log(`Session restore failed: ${e}`);
      setSession(null);
      try { await invoke('auth_session_clear'); } catch {}
    }
  }

  React.useEffect(() => {
    (async () => {
      await loadSessionFromBackend();
    })();

    const unlistenPromise = listen<string>('emw_flash_progress', (event) => {
      // Progress comes from the DFU crate as "... (NN%)"
      const msg = event.payload;
      setFlashProgress(msg);
      const m = msg.match(/\((\d+)%\)/);
      if (m) setFlashPercent(parseInt(m[1], 10));
      setStatus(msg);
      log(msg);
    });

    void refreshDetections(true);
    const t = setInterval(() => {
      void refreshDetections(true);
    }, 1000);

    return () => {
      clearInterval(t);
      void unlistenPromise.then((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (session?.refresh_token) {
      void tryRestore(session);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.refresh_token]);

  async function refreshDetections(silent = true) {
    try {
      const ports = await invoke<string[]>('detect_device');
      setRunModePorts(ports);
    } catch {
      setRunModePorts([]);
    }

    try {
      const info = await invoke<UpdateModeInfo>('update_mode_detect');
      setUpdateModeInfo(info);
    } catch {
      setUpdateModeInfo(null);
    }

    if (!silent) {
      setStatus('Detection updated');
    }
  }

  async function loginGoogle() {
    setStatus('Signing in with Google…');
    try {
      const s = await invoke<AuthSession>('auth_google_sign_in');
      setSession(s);
      setStatus('Signed in');
      log('Signed in');
    } catch (e: any) {
      setStatus(`Sign-in failed: ${e}`);
      log(`Sign-in failed: ${e}`);
    }
  }

  async function logout() {
    setSession(null);
    try { await invoke('auth_session_clear'); } catch {}
    setStatus('Signed out');
    log('Signed out');
  }

  async function selectFirmware() {
    const picked = await open({ title: 'Select firmware (.bin)', multiple: false });
    if (!picked || Array.isArray(picked)) return;
    setFirmwarePath(picked);
    setUseCustomFirmware(true);
    setStatus('Custom firmware selected');
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

  async function updateDevicePreservingIdentity() {
    try {
      setFlashProgress(null);
      setFlashPercent(null);
      setStatus('Updating device…');
      log('Update device (preserve identity): start');
      await invoke('update_device_preserve_identity', {
        firmwarePath: useCustomFirmware ? firmwarePath : null
      });
      setStatus('Update complete');
      log('Update device (preserve identity): complete');
    } catch (e: any) {
      setStatus(`Update failed: ${e}`);
      log(`Update failed: ${e}`);
    }
  }

  async function mintAndProvision() {
    if (!session?.id_token) {
      setStatus('Missing login');
      log('Provision failed: missing login');
      return;
    }
    if (useCustomFirmware && !firmwarePath) {
      setStatus('Missing custom firmware file');
      log('Provision failed: missing custom firmware file');
      return;
    }

    try {
      setStatus('Minting identity…');
      log('Mint identity: start');
      const m = await mintFromBackend(session.id_token);
      log('Mint identity: ok');

      setFlashProgress(null);
      setFlashPercent(null);
      setStatus('Provisioning in Update Mode…');
      log('Provision: start');
      await invoke('dfu_provision_device', {
        firmwarePath: useCustomFirmware ? firmwarePath : null,
        deviceIdB64: m.device_id_b64,
        proofB64: m.proof_b64
      });
      setStatus('Provisioning complete');
      log('Provision: complete');
    } catch (e: any) {
      setStatus(`Provisioning failed: ${e}`);
      log(`Provisioning failed: ${e}`);
    }
  }

  const canProvision = true;

  return (
    <div className="sw-wrap">
      {page === 'settings' ? (
        <div className="sw-topbar">
          <div className="sw-title">
            <h1>Settings</h1>
            <p>Backend selection.</p>
          </div>

          <div className="sw-row">
            <button className="sw-btn" onClick={() => setPage('main')}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="sw-topbar">
          <div className="sw-title">
            <h1>SecureWaver</h1>
            <p>Provisioning (mint DeviceID+Proof from backend, then flash in Update Mode).</p>
          </div>

          <div className="sw-row">
            <span className="sw-pill">
              <span style={{ width: 8, height: 8, borderRadius: 99, background: session ? 'var(--aqua)' : 'rgba(233,238,252,0.25)' }} />
              {signedInLabel}
            </span>
            <button className="sw-btn" onClick={() => setPage('settings')}>
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
      )}

      <div className={status.toLowerCase().includes('failed') ? 'sw-banner error' : 'sw-banner'}>
        <strong>Status:</strong> {status}
      </div>

      <div style={{ height: 12 }} />

      {page === 'settings' ? (
        <div className="sw-card">
          <div className="sw-card-h">
            <h2>Backend</h2>
            <div className="sub">Select which backend SecureWaver uses.</div>
          </div>
          <div className="sw-card-b">
            <div className="sw-row">
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

            <div style={{ height: 10 }} />

            <div style={{ fontSize: 12, color: 'var(--ink-dim)' }}>
              Current: <code>{backendUrl}</code>
            </div>
          </div>
        </div>
      ) : (
        <div className="sw-grid">
        <div className="sw-card">
          <div className="sw-card-h">
            <h2>Connections</h2>
            <div className="sub">Run Mode (USB MIDI) + Update Mode detection.</div>
          </div>
          <div className="sw-card-b">
            <div className="sw-row" style={{ justifyContent: 'space-between' }}>
              <div style={{ fontSize: 12, color: 'var(--ink-dim)' }}>
                Run Mode: <code>{runModePorts.length > 0 ? 'Detected' : 'Not detected'}</code>
                {'  '}|{'  '}
                Update Mode: <code>{updateModeInfo ? 'Detected' : 'Not detected'}</code>
              </div>
              <button className="sw-btn" onClick={() => refreshDetections(false)}>
                Recheck
              </button>
            </div>

            <div style={{ height: 10 }} />

            <div className="sw-row">
              <button
                className="sw-btn"
                disabled={runModePorts.length === 0}
                onClick={async () => {
                  try {
                    setStatus('Verifying device…');
                    const r = await invoke<LegitCheckResult>('check_device_legit_run_mode');
                    setLegit(r);
                    setStatus(r.ok ? 'Certified original EMWaver device' : 'Not a certified original device');
                    log(`Verify (Run Mode): ${r.ok ? 'CERTIFIED' : 'NOT CERTIFIED'} via ${r.transport}`);
                    if (r.details?.length) {
                      for (const line of r.details) log(line);
                    }
                    if (r.device_id_b64) log(`DeviceID: ${r.device_id_b64.slice(0, 16)}…`);
                    if (r.proof_b64) log(`Proof: ${r.proof_b64.slice(0, 16)}…`);
                  } catch (e: any) {
                    setStatus(`Verify failed: ${e}`);
                    log(`Verify failed: ${e}`);
                  }
                }}
              >
                Verify certified original
              </button>

              <button
                className="sw-btn"
                disabled={!updateModeInfo}
                onClick={async () => {
                  try {
                    setStatus('Verifying device…');
                    const r = await invoke<LegitCheckResult>('check_device_legit_update_mode');
                    setLegit(r);
                    setStatus(r.ok ? 'Certified original EMWaver device' : 'Not a certified original device');
                    log(`Verify (Update Mode): ${r.ok ? 'CERTIFIED' : 'NOT CERTIFIED'} via ${r.transport}`);
                    if (r.details?.length) {
                      for (const line of r.details) log(line);
                    }
                    if (r.device_id_b64) log(`DeviceID: ${r.device_id_b64.slice(0, 16)}…`);
                    if (r.proof_b64) log(`Proof: ${r.proof_b64.slice(0, 16)}…`);
                  } catch (e: any) {
                    setStatus(`Verify failed: ${e}`);
                    log(`Verify failed: ${e}`);
                  }
                }}
              >
                Verify certified original
              </button>
            </div>
          </div>
        </div>

        <div className="sw-card">
          <div className="sw-card-h">
            <h2>Update Mode</h2>
            <div className="sub">Enter Update Mode if you need to flash firmware.</div>
          </div>
          <div className="sw-card-b">
            <div className="sw-row">
              <button
                className="sw-btn sw-btn-primary"
                onClick={async () => {
                  try {
                    setStatus('Requesting Update Mode…');
                    const port = await invoke<string>('request_enter_update_mode');
                    setStatus(`Update Mode requested via ${port}. Unplug and plug the device again.`);
                  } catch (e: any) {
                    setStatus(`Failed to enter Update Mode: ${e}`);
                  }
                }}
              >
                Enter Update Mode
              </button>
            </div>

            <div style={{ height: 12 }} />

            <div style={{ fontSize: 12, color: 'var(--ink-dim)' }}>
              After entering Update Mode, unplug and plug the device back in.
            </div>

            <div style={{ height: 14 }} />

            {flashProgress && (
              <div className="sw-banner" style={{ marginBottom: 12 }}>
                <strong>Flashing:</strong> {flashProgress}
                {typeof flashPercent === 'number' && (
                  <div style={{ marginTop: 8, height: 6, background: 'rgba(233,238,252,0.12)', borderRadius: 99 }}>
                    <div
                      style={{
                        width: `${Math.max(0, Math.min(100, flashPercent))}%`,
                        height: 6,
                        background: 'var(--aqua)',
                        borderRadius: 99
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginBottom: 6 }}>
              Update device
            </div>

            <div className="sw-row">
              <button className="sw-btn sw-btn-primary" onClick={updateDevicePreservingIdentity}>
                Update device (preserve identity)
              </button>
            </div>

            <div style={{ height: 14 }} />

            <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginBottom: 6 }}>
              Mint + Provision
            </div>

            <div className="sw-row">
              <button className="sw-btn sw-btn-primary" onClick={mintAndProvision}>
                Mint + Provision
              </button>
              <button
                className="sw-btn"
                onClick={() => {
                  setUseCustomFirmware((v) => !v);
                  if (useCustomFirmware) {
                    setFirmwarePath(null);
                    setStatus('Using bundled firmware');
                  }
                }}
              >
                {useCustomFirmware ? 'Use bundled firmware' : 'Use custom firmware…'}
              </button>
              {useCustomFirmware && (
                <button className="sw-btn" onClick={selectFirmware}>
                  Select .bin…
                </button>
              )}
            </div>

            <div style={{ height: 12 }} />
          </div>
        </div>

        <div className="sw-card">
          <div className="sw-card-h">
            <h2>Log</h2>
            <div className="sub">What happened (most recent first).</div>
          </div>
          <div className="sw-card-b">
            <div className="sw-row" style={{ justifyContent: 'space-between' }}>
              <div style={{ fontSize: 12, color: 'var(--ink-dim)' }}>
                Device: <code>{runModePorts.length > 0 ? 'Detected' : (updateModeInfo ? 'Update Mode' : 'Not detected')}</code>
              </div>
              <button className="sw-btn" onClick={() => setLogLines([])}>
                Clear
              </button>
            </div>

            <div style={{ height: 10 }} />

            <pre className="sw-pre">{logLines.length ? logLines.join('\n') : 'No log yet.'}</pre>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
