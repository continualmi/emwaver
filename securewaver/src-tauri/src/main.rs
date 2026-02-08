// SecureWaver - internal EMWaver provisioning UI
//
// Tauri-side responsibilities:
// - DFU probe
// - Flash firmware via DFU
// - Write identity page (DeviceID + Proof) via DFU
//
// Minting (DeviceID + Proof signing) happens on the backend.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::Serialize;
use std::fs;

type AnyResult<T> = Result<T, String>;

const DEVICE_ID_LEN: usize = 16;
const PROOF_LEN: usize = 64; // Ed25519 signature bytes

// STM32F042 flash page size is 1KB; keep identity within a single page so it doesn't clobber other data.
const IDENTITY_PAGE_SIZE: usize = 1024;
const DEFAULT_IDENTITY_PAGE_ADDR: u32 = 0x0800_7800; // last 1KB page on STM32F042 (32KB flash)

#[derive(Debug, Clone, Serialize)]
struct DfuAltSettingInfo {
    setting_number: u8,
    description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct DfuDiscoveryInfo {
    interface_number: u8,
    alt_settings: Vec<DfuAltSettingInfo>,
    selected_alt_setting: Option<u8>,
}

#[tauri::command]
fn dfu_probe() -> AnyResult<DfuDiscoveryInfo> {
    let (_dev, info) = emwaver_dfu::DfuDevice::open_with_options(
        emwaver_dfu::DEFAULT_USB_VENDOR_ID,
        emwaver_dfu::DEFAULT_USB_PRODUCT_ID,
        emwaver_dfu::DfuOpenOptions {
            alt_setting: None,
            verbose: false,
        },
    )
    .map_err(|e| format!("{e}"))?;

    Ok(DfuDiscoveryInfo {
        interface_number: info.interface_number,
        alt_settings: info
            .alt_settings
            .into_iter()
            .map(|a| DfuAltSettingInfo {
                setting_number: a.setting_number,
                description: a.description,
            })
            .collect(),
        selected_alt_setting: info.selected_alt_setting,
    })
}

fn build_identity_page(device_id: &[u8], proof: &[u8]) -> AnyResult<Vec<u8>> {
    if device_id.len() != DEVICE_ID_LEN {
        return Err(format!("DeviceID must be {DEVICE_ID_LEN} bytes"));
    }
    if proof.len() != PROOF_LEN {
        return Err(format!("Proof must be {PROOF_LEN} bytes"));
    }

    // Layout must match firmware expectations:
    // [0..4]  magic 'EMID'
    // [4]     version 1
    // [5]     device_id_len
    // [6]     proof_len
    // [7..15] reserved
    // [16..]  device_id then proof
    let mut page = vec![0xFFu8; IDENTITY_PAGE_SIZE];
    page[0..4].copy_from_slice(b"EMID");
    page[4] = 1;
    page[5] = DEVICE_ID_LEN as u8;
    page[6] = PROOF_LEN as u8;

    let mut off = 16usize;
    page[off..off + DEVICE_ID_LEN].copy_from_slice(device_id);
    off += DEVICE_ID_LEN;
    page[off..off + PROOF_LEN].copy_from_slice(proof);

    Ok(page)
}

#[derive(Debug, Clone, Serialize)]
struct ProvisionResult {
    identity_page_addr: u32,
    firmware_path: String,
    wrote_identity: bool,
}

/// Factory provisioning step: flash firmware (mass-erase) and then write DeviceID+Proof into the identity page.
#[tauri::command]
fn dfu_provision_device(
    firmware_path: String,
    device_id_b64: String,
    proof_b64: String,
    identity_page_addr: Option<u32>,
) -> AnyResult<ProvisionResult> {
    let firmware = fs::read(&firmware_path)
        .map_err(|e| format!("Failed to read firmware file {firmware_path}: {e}"))?;

    let device_id = B64
        .decode(device_id_b64)
        .map_err(|e| format!("Invalid DeviceID base64: {e}"))?;
    let proof = B64
        .decode(proof_b64)
        .map_err(|e| format!("Invalid Proof base64: {e}"))?;

    let page_addr = identity_page_addr.unwrap_or(DEFAULT_IDENTITY_PAGE_ADDR);
    let identity_page = build_identity_page(&device_id, &proof)?;

    let (mut dev, _info) = emwaver_dfu::DfuDevice::open_with_options(
        emwaver_dfu::DEFAULT_USB_VENDOR_ID,
        emwaver_dfu::DEFAULT_USB_PRODUCT_ID,
        emwaver_dfu::DfuOpenOptions {
            alt_setting: None,
            verbose: false,
        },
    )
    .map_err(|e| format!("{e}"))?;

    // Flash firmware (this performs a mass erase).
    dev.flash(&firmware, 0x0800_0000, |_| {})
        .map_err(|e| format!("DFU flash failed: {e}"))?;

    // Write identity page after firmware.
    dev.set_address_pointer(page_addr)
        .map_err(|e| format!("DFU set address pointer failed: {e}"))?;
    dev.write_block(2, &identity_page)
        .map_err(|e| format!("DFU write identity page failed: {e}"))?;

    Ok(ProvisionResult {
        identity_page_addr: page_addr,
        firmware_path,
        wrote_identity: true,
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![dfu_probe, dfu_provision_device])
        .run(tauri::generate_context!())
        .expect("error while running SecureWaver");
}
