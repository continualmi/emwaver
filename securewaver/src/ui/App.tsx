import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
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
  const [rootInfo, setRootInfo] = useState<RootKeygenResult | null>(null);
  const [rootPrivateKeyPath, setRootPrivateKeyPath] = useState<string | null>(null);
  const [firmwarePath, setFirmwarePath] = useState<string | null>(null);
  const [minted, setMinted] = useState<DeviceMintResult | null>(null);
  const [provisionResult, setProvisionResult] = useState<ProvisionResult | null>(null);

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
      setRootPrivateKeyPath(privPath);
      setStatus('Root keypair generated and saved');
    } catch (e: any) {
      setStatus(`Root key generation failed: ${e}`);
    }
  }

  async function selectRootPrivateKey() {
    const picked = await open({
      title: 'Select EMWaver Root PRIVATE key',
      multiple: false
    });
    if (!picked || Array.isArray(picked)) return;
    setRootPrivateKeyPath(picked);
    setStatus('Root private key selected');
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

  async function mintAndProvision() {
    setProvisionResult(null);

    if (!rootPrivateKeyPath) {
      setStatus('Missing root private key');
      return;
    }
    if (!firmwarePath) {
      setStatus('Missing firmware file');
      return;
    }

    try {
      setStatus('Minting DeviceID + Proof…');
      const m = await invoke<DeviceMintResult>('mint_device', {
        rootPrivateKeyPath
      });
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
    <div style={{ fontFamily: 'system-ui', padding: 16, maxWidth: 900 }}>
      <h1 style={{ marginTop: 0 }}>SecureWaver</h1>
      <p style={{ color: '#555' }}>
        Internal EMWaver provisioning tool (DFU + DeviceID minting + Proof signing).
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={generateRoot}>Generate Root keypair…</button>
        <button onClick={selectRootPrivateKey}>Select Root PRIVATE key…</button>
        <button onClick={selectFirmware}>Select firmware…</button>
        <button onClick={probe}>Probe DFU device</button>
        <button onClick={mintAndProvision}>Mint + Provision (DFU)</button>
        <div><b>Status:</b> {status}</div>
      </div>

      <div style={{ marginTop: 10, color: '#555' }}>
        <div><b>Root private key:</b> {rootPrivateKeyPath ?? '(not selected)'}</div>
        <div><b>Firmware:</b> {firmwarePath ?? '(not selected)'}</div>
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
        <li>Generate Root keypair once (keep private key offline).</li>
        <li>Select Root PRIVATE key + firmware.</li>
        <li>Mint DeviceID + Proof (signature) and flash DeviceID+Proof to the device.</li>
        <li>Apps verify offline; server verifies again for cloud feature gating.</li>
      </ol>
    </div>
  );
}
