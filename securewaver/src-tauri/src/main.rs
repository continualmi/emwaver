// SecureWaver - internal EMWaver provisioning UI

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use ed25519_dalek::{Signer, SigningKey};
use rand_core::{OsRng, RngCore};
use serde::Serialize;
use std::{fs, path::Path, time::{SystemTime, UNIX_EPOCH}};
use zeroize::Zeroize;

type AnyResult<T> = Result<T, String>;

const DEVICE_ID_LEN: usize = 16;
const PROOF_LEN: usize = 64; // Ed25519 signature
// STM32F042 flash page size is 1KB; keep identity within a single page so it doesn't clobber other data.
const IDENTITY_PAGE_SIZE: usize = 1024;
const DEFAULT_IDENTITY_PAGE_ADDR: u32 = 0x0800_7800; // last 2KB page on STM32F042 (32KB flash)

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

#[derive(Debug, Clone, Serialize)]
struct RootKeygenResult {
    root_public_key_b64: String,
    root_private_key_path: String,
    root_public_key_path: String,
}

fn write_new_file(path: &Path, contents: &[u8]) -> AnyResult<()> {
    if path.exists() {
        return Err(format!(
            "Refusing to overwrite existing file: {}",
            path.display()
        ));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory {}: {e}", parent.display()))?;
    }
    fs::write(path, contents)
        .map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    Ok(())
}

/// Generates a new Root keypair and writes it to disk.
///
/// - Private key: raw 32 bytes base64 (plus a small header) 
/// - Public key: raw 32 bytes base64 (plus a small header)
///
/// The Root private key must be stored offline (safe).
#[tauri::command]
fn root_generate_and_save(root_private_key_path: String, root_public_key_path: String) -> AnyResult<RootKeygenResult> {
    let mut csprng = OsRng;
    let signing_key = SigningKey::generate(&mut csprng);
    let verifying_key = signing_key.verifying_key();

    let mut priv_bytes = signing_key.to_bytes();
    let pub_bytes = verifying_key.to_bytes();

    let priv_b64 = B64.encode(priv_bytes);
    let pub_b64 = B64.encode(pub_bytes);

    // Zeroize private key bytes as soon as we no longer need them.
    priv_bytes.zeroize();

    let priv_out = format!(
        "EMWAVER_ROOT_PRIVATE_KEY_V1\nencoding: base64\nbytes: 32\nkey: {}\n",
        priv_b64
    );
    let pub_out = format!(
        "EMWAVER_ROOT_PUBLIC_KEY_V1\nencoding: base64\nbytes: 32\nkey: {}\n",
        pub_b64
    );

    let priv_path = Path::new(&root_private_key_path);
    let pub_path = Path::new(&root_public_key_path);

    write_new_file(priv_path, priv_out.as_bytes())?;
    write_new_file(pub_path, pub_out.as_bytes())?;

    Ok(RootKeygenResult {
        root_public_key_b64: pub_b64,
        root_private_key_path,
        root_public_key_path,
    })
}

fn parse_root_private_key_file(path: &Path) -> AnyResult<SigningKey> {
    let text = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read root private key file {}: {e}", path.display()))?;
    if !text.starts_with("EMWAVER_ROOT_PRIVATE_KEY_V1") {
        return Err("Unrecognized root private key file header".to_string());
    }
    let key_line = text
        .lines()
        .find(|l| l.trim_start().starts_with("key:"))
        .ok_or_else(|| "Root private key file missing 'key:' line".to_string())?;
    let b64 = key_line
        .splitn(2, ':')
        .nth(1)
        .ok_or_else(|| "Invalid 'key:' line".to_string())?
        .trim();

    let bytes = B64
        .decode(b64)
        .map_err(|e| format!("Invalid base64 in root private key: {e}"))?;
    if bytes.len() != 32 {
        return Err(format!("Root private key must be 32 bytes, got {}", bytes.len()));
    }
    let mut sk = [0u8; 32];
    sk.copy_from_slice(&bytes);
    // bytes Vec can be dropped; we keep only the stack copy.
    Ok(SigningKey::from_bytes(&sk))
}

#[derive(Debug, Clone, Serialize)]
struct DeviceMintResult {
    device_id_b64: String,
    proof_b64: String,
    algorithm: String,
    device_id_len: u32,
    proof_len: u32,
}

/// Mint a new DeviceID and Proof (signature) using the offline Root private key.
#[tauri::command]
fn mint_device(root_private_key_path: String) -> AnyResult<DeviceMintResult> {
    let root_path = Path::new(&root_private_key_path);
    let signing_key = parse_root_private_key_file(root_path)?;

    let mut device_id = [0u8; DEVICE_ID_LEN];
    let mut rng = OsRng;
    rng.fill_bytes(&mut device_id);

    let proof = signing_key.sign(&device_id);

    Ok(DeviceMintResult {
        device_id_b64: B64.encode(device_id),
        proof_b64: B64.encode(proof.to_bytes()),
        algorithm: "ed25519".to_string(),
        device_id_len: DEVICE_ID_LEN as u32,
        proof_len: PROOF_LEN as u32,
    })
}

fn build_identity_page(device_id: &[u8], proof: &[u8]) -> AnyResult<Vec<u8>> {
    if device_id.len() != DEVICE_ID_LEN {
        return Err(format!("DeviceID must be {DEVICE_ID_LEN} bytes"));
    }
    if proof.len() != PROOF_LEN {
        return Err(format!("Proof must be {PROOF_LEN} bytes"));
    }

    // Simple fixed layout in a full 2KB DFU block.
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

    // Add a timestamp (best-effort) for debugging/provenance.
    if let Ok(ms) = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64) {
        let ts = ms.to_le_bytes();
        let ts_off = off + PROOF_LEN;
        if ts_off + ts.len() <= page.len() {
            page[ts_off..ts_off + ts.len()].copy_from_slice(&ts);
        }
    }

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
        .invoke_handler(tauri::generate_handler![
            dfu_probe,
            root_generate_and_save,
            mint_device,
            dfu_provision_device
        ])
        .run(tauri::generate_context!())
        .expect("error while running SecureWaver");
}
