import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import React, { useEffect, useMemo, useState } from 'react';
import { initFirebase } from '../firebase';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';

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

export default function App() {
  const [status, setStatus] = useState<string>('Idle');
  const [dfuInfo, setDfuInfo] = useState<DfuInfo | null>(null);
  const [firmwarePath, setFirmwarePath] = useState<string | null>(null);
  const [minted, setMinted] = useState<DeviceMintResult | null>(null);
  const [provisionResult, setProvisionResult] = useState<ProvisionResult | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [backendUrl, setBackendUrl] = useState<string>(
    (import.meta.env.VITE_BACKEND_URL as string) || 'https://api.emwavers.com'
  );

  const [firebaseError, setFirebaseError] = useState<string | null>(null);

  const fb = useMemo(() => {
    try {
      const v = initFirebase();
      setFirebaseError(null);
      return v;
    } catch (e: any) {
      setFirebaseError(String(e?.message ?? e));
      return null;
    }
  }, []);

  useEffect(() => {
    if (!fb) return;
    return onAuthStateChanged(fb.auth, (u) => setUser(u));
  }, [fb]);

  const userLabel = useMemo(() => {
    if (!user) return '(not signed in)';
    return user.email || user.uid;
  }, [user]);

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
      if (!fb) throw new Error(firebaseError ?? 'Firebase not configured');
      await signInWithPopup(fb.auth, fb.googleProvider);
      setStatus('Signed in');
    } catch (e: any) {
      setStatus(`Sign-in failed: ${e}`);
    }
  }

  async function logout() {
    try {
      if (!fb) throw new Error(firebaseError ?? 'Firebase not configured');
      await signOut(fb.auth);
      setStatus('Signed out');
    } catch (e: any) {
      setStatus(`Sign-out failed: ${e}`);
    }
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

  async function mintFromBackend(): Promise<DeviceMintResult> {
    if (!user) throw new Error('Not signed in');
    const idToken = await user.getIdToken();

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

    if (!user) {
      setStatus('Missing login');
      return;
    }
    if (!firmwarePath) {
      setStatus('Missing firmware file');
      return;
    }

    try {
      setStatus('Requesting DeviceID+Proof from backend…');
      const m = await mintFromBackend();
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
        Internal provisioning tool (Google/Firebase auth + backend mint + DFU flash).
      </p>

      {firebaseError && (
        <div style={{ marginTop: 12, padding: 12, background: '#fff3cd', borderRadius: 8 }}>
          <b>Firebase config error:</b> {firebaseError}
          <div style={{ marginTop: 6, color: '#555' }}>
            This causes a blank screen if SecureWaver cannot initialize Firebase. Fix by setting Vite env vars.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {!user ? (
          <button onClick={loginGoogle}>Sign in with Google…</button>
        ) : (
          <button onClick={logout}>Sign out</button>
        )}

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
          <b>Backend:</b>{' '}
          <input
            value={backendUrl}
            onChange={(e) => setBackendUrl(e.target.value)}
            style={{ width: 420 }}
          />
        </div>
        <div>
          <b>Firmware:</b> {firmwarePath ?? '(not selected)'}
        </div>
      </div>

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
      <h2>Flow</h2>
      <ol>
        <li>Sign in with Google (Firebase). Backend allowlists a single email.</li>
        <li>Backend mints DeviceID+Proof using the Root private key stored server-side.</li>
        <li>SecureWaver flashes firmware and identity page via DFU.</li>
      </ol>
    </div>
  );
}
