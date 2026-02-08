import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import React, { useState } from 'react';

type DfuInfo = {
  interface_number: number;
  alt_settings: { setting_number: number; description?: string | null }[];
  selected_alt_setting?: number | null;
};

type RootKeygenResult = {
  root_public_key_b64: string;
  root_private_key_path: string;
  root_public_key_path: string;
};

export default function App() {
  const [status, setStatus] = useState<string>('Idle');
  const [dfuInfo, setDfuInfo] = useState<DfuInfo | null>(null);
  const [rootInfo, setRootInfo] = useState<RootKeygenResult | null>(null);

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

  async function generateRoot() {
    setStatus('Generating Root keypair…');
    setRootInfo(null);

    const privPath = await save({
      title: 'Save EMWaver Root PRIVATE key',
      defaultPath: 'emwaver_root_private.key'
    });
    if (!privPath) {
      setStatus('Cancelled');
      return;
    }

    const pubPath = await save({
      title: 'Save EMWaver Root PUBLIC key',
      defaultPath: 'emwaver_root_public.key'
    });
    if (!pubPath) {
      setStatus('Cancelled');
      return;
    }

    try {
      const info = await invoke<RootKeygenResult>('root_generate_and_save', {
        rootPrivateKeyPath: privPath,
        rootPublicKeyPath: pubPath
      });
      setRootInfo(info);
      setStatus('Root keypair generated and saved');
    } catch (e: any) {
      setStatus(`Root key generation failed: ${e}`);
    }
  }

  return (
    <div style={{ fontFamily: 'system-ui', padding: 16, maxWidth: 900 }}>
      <h1 style={{ marginTop: 0 }}>SecureWaver</h1>
      <p style={{ color: '#555' }}>
        Internal EMWaver provisioning tool (DFU + key/cert provisioning + RDP1).
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={generateRoot}>Generate Root keypair…</button>
        <button onClick={probe}>Probe DFU device</button>
        <div><b>Status:</b> {status}</div>
      </div>

      {rootInfo && (
        <div style={{ marginTop: 16 }}>
          <h2>Root keypair</h2>
          <div style={{ color: '#555', marginBottom: 8 }}>
            Root private key is saved to disk. Keep it offline (safe). Do not commit it.
          </div>
          <pre style={{ background: '#f6f6f6', padding: 12, borderRadius: 8, overflowX: 'auto' }}>
            {JSON.stringify(rootInfo, null, 2)}
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
      <h2>Next steps (TODO)</h2>
      <ol>
        <li>Generate/import Root key (offline) + choose key version</li>
        <li>Generate per-device keypair + Root-signed cert</li>
        <li>Flash key/cert into reserved page (preserve across updates)</li>
        <li>Flash firmware</li>
        <li>Set RDP1 option bytes</li>
        <li>Verify handshake (“secure connected”)</li>
      </ol>
    </div>
  );
}
