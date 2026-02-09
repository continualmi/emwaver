// SecureWaver - internal EMWaver provisioning UI
//
// Tauri-side responsibilities:
// - Update Mode detection (device bootloader presence)
// - Flash firmware in Update Mode
// - Write identity page (DeviceID + Proof) in Update Mode
//
// Minting (DeviceID + Proof signing) happens on the backend.

mod auth_google;
mod legit_check;
mod session_store;
mod update_mode;
mod update_mode_identity;
mod usb_midi_sysex;

// Dev convenience: load env vars from a local .env file when present.
// Note: packaged apps should rely on configured environment/launchd, not .env.
#[allow(unused_imports)]
use dotenvy::dotenv;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Serialize, Deserialize};
use std::fs;

type AnyResult<T> = Result<T, String>;

#[derive(Debug, Clone, Serialize)]
struct LegitCheckResult {
    ok: bool,
    transport: String,
    device_id_b64: Option<String>,
    proof_b64: Option<String>,
}

#[tauri::command]
fn detect_device() -> AnyResult<Vec<String>> {
    legit_check::detect_run_mode_device()
}

#[tauri::command]
fn check_device_legit_run_mode() -> AnyResult<LegitCheckResult> {
    let r = legit_check::run_mode_legit_check()?;
    Ok(LegitCheckResult {
        ok: r.ok,
        transport: format!("Run Mode ({})", r.port_name),
        device_id_b64: Some(r.device_id_b64),
        proof_b64: Some(r.proof_b64),
    })
}

#[tauri::command]
fn check_device_legit_update_mode() -> AnyResult<LegitCheckResult> {
    let (mut dev, info) = emwaver_dfu::DfuDevice::open_with_options(
        emwaver_dfu::DEFAULT_USB_VENDOR_ID,
        emwaver_dfu::DEFAULT_USB_PRODUCT_ID,
        emwaver_dfu::DfuOpenOptions {
            alt_setting: None,
            verbose: false,
        },
    )
    .map_err(|e| format!("{e}"))?;

    let r = update_mode_identity::read_and_verify_identity_page(
        &mut dev,
        DEFAULT_IDENTITY_PAGE_ADDR,
    )?;

    Ok(LegitCheckResult {
        ok: r.ok,
        transport: format!("Update Mode (iface {})", info.interface_number),
        device_id_b64: r.device_id_b64,
        proof_b64: r.proof_b64,
    })
}

#[tauri::command]
fn request_enter_update_mode() -> AnyResult<String> {
    update_mode::enter_update_mode_via_midi()
}

const DEVICE_ID_LEN: usize = 16;
const PROOF_LEN: usize = 64; // Ed25519 signature bytes

// Flash page size is 1KB on the shipped device; keep identity within a single page so it doesn't clobber other data.
const IDENTITY_PAGE_SIZE: usize = 1024;
const DEFAULT_IDENTITY_PAGE_ADDR: u32 = 0x0800_7800; // identity page (last 1KB page)

#[derive(Debug, Clone, Serialize)]
struct DfuAltSettingInfo {
    setting_number: u8,
    description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct DfuDiscoveryInfo {
    interface_number: u8,
    // Intentionally hidden from UI.
    alt_settings: Vec<DfuAltSettingInfo>,
    selected_alt_setting: Option<u8>,
}

#[tauri::command]
fn update_mode_detect() -> AnyResult<DfuDiscoveryInfo> {
    let (_dev, info) = emwaver_dfu::DfuDevice::open_with_options(
        emwaver_dfu::DEFAULT_USB_VENDOR_ID,
        emwaver_dfu::DEFAULT_USB_PRODUCT_ID,
        emwaver_dfu::DfuOpenOptions {
            alt_setting: None,
            verbose: false,
        },
    )
    .map_err(|e| format!("{e}"))?;

    // Don't surface alt-setting descriptions to the UI (some targets are option-bytes).
    Ok(DfuDiscoveryInfo {
        interface_number: info.interface_number,
        alt_settings: vec![],
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

#[derive(Debug, Clone, Serialize)]
struct UpdatePreserveIdentityResult {
    identity_page_addr: u32,
    firmware_path: String,
    restored_identity: bool,
}

/// Provisioning step: flash firmware (mass-erase) and then write DeviceID+Proof into the identity page.
///
/// `firmware_path` is optional: if omitted, SecureWaver uses the bundled firmware payload.
#[tauri::command]
fn dfu_provision_device(
    firmware_path: Option<String>,
    device_id_b64: String,
    proof_b64: String,
    identity_page_addr: Option<u32>,
) -> AnyResult<ProvisionResult> {
    let (firmware, firmware_path) = if let Some(p) = firmware_path {
        let fw = fs::read(&p).map_err(|e| format!("Failed to read firmware file {p}: {e}"))?;
        (fw, p)
    } else {
        // Bundled firmware payload (same idea as other apps).
        let fw: &[u8] = include_bytes!("../../../firmware/emwaver.bin");
        (fw.to_vec(), "(bundled)".to_string())
    };

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
        .map_err(|e| format!("Firmware flash failed: {e}"))?;

    // Write identity page after firmware.
    // Some hosts/devices need a short settle after mass erase + flash.
    // Best-effort recover if the device reports busy.
    let _ = dev.abort();
    let _ = dev.clear_status();

    dev.set_address_pointer(page_addr)
        .map_err(|e| format!("Update Mode set address pointer failed: {e}"))?;
    dev.write_block(2, &identity_page)
        .map_err(|e| format!("Update Mode write identity page failed: {e}"))?;

    Ok(ProvisionResult {
        identity_page_addr: page_addr,
        firmware_path,
        wrote_identity: true,
    })
}

#[tauri::command]
fn update_device_preserve_identity(firmware_path: Option<String>) -> AnyResult<UpdatePreserveIdentityResult> {
    let (firmware, firmware_path) = if let Some(p) = firmware_path {
        let fw = fs::read(&p).map_err(|e| format!("Failed to read firmware file {p}: {e}"))?;
        (fw, p)
    } else {
        let fw: &[u8] = include_bytes!("../../../firmware/emwaver.bin");
        (fw.to_vec(), "(bundled)".to_string())
    };

    let page_addr = DEFAULT_IDENTITY_PAGE_ADDR;

    let (mut dev, _info) = emwaver_dfu::DfuDevice::open_with_options(
        emwaver_dfu::DEFAULT_USB_VENDOR_ID,
        emwaver_dfu::DEFAULT_USB_PRODUCT_ID,
        emwaver_dfu::DfuOpenOptions {
            alt_setting: None,
            verbose: false,
        },
    )
    .map_err(|e| format!("{e}"))?;

    // Read and validate identity page first.
    let identity_page = update_mode_identity::read_identity_page_raw(&mut dev, page_addr)?;
    if identity_page.len() < 16 || &identity_page[0..4] != b"EMID" {
        return Err("Missing identity header. Refusing to update (would erase identity).".to_string());
    }

    // Flash firmware (mass erase).
    dev.flash(&firmware, 0x0800_0000, |_| {})
        .map_err(|e| format!("Firmware flash failed: {e}"))?;

    // Restore identity page.
    let _ = dev.abort();
    let _ = dev.clear_status();

    dev.set_address_pointer(page_addr)
        .map_err(|e| format!("Update Mode set address pointer failed: {e}"))?;
    dev.write_block(2, &identity_page)
        .map_err(|e| format!("Update Mode write identity page failed: {e}"))?;

    Ok(UpdatePreserveIdentityResult {
        identity_page_addr: page_addr,
        firmware_path,
        restored_identity: true,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SecurewaverAuthSession {
    id_token: String,
    refresh_token: String,
    email: Option<String>,
    display_name: Option<String>,
    uid: Option<String>,
}

#[tauri::command]
fn auth_session_get(app: tauri::AppHandle) -> AnyResult<Option<SecurewaverAuthSession>> {
    session_store::get(&app)
}

#[tauri::command]
fn auth_session_clear(app: tauri::AppHandle) -> AnyResult<()> {
    session_store::clear(&app)
}

#[tauri::command]
async fn auth_google_sign_in(app: tauri::AppHandle) -> AnyResult<SecurewaverAuthSession> {
    let google_client_id = (std::env::var("EMWAVER_GOOGLE_CLIENT_ID").unwrap_or_default()).trim().to_string();
    let google_client_secret = (std::env::var("EMWAVER_GOOGLE_CLIENT_SECRET").unwrap_or_default()).trim().to_string();
    let firebase_web_api_key = (std::env::var("EMWAVER_FIREBASE_WEB_API_KEY").unwrap_or_default()).trim().to_string();

    let fb = auth_google::sign_in_google_pkce_firebase(
        google_client_id,
        google_client_secret,
        firebase_web_api_key,
    )
    .await?;

    let session = SecurewaverAuthSession {
        id_token: fb.id_token,
        refresh_token: fb.refresh_token,
        email: fb.email,
        display_name: fb.display_name,
        uid: fb.local_id,
    };

    // Persist session so relaunch doesn't require sign-in.
    let _ = session_store::set(&app, &session);

    Ok(session)
}

#[derive(Debug, Clone, serde::Deserialize)]
struct FirebaseRefreshResponse {
    #[serde(rename = "id_token")]
    id_token: String,
    #[serde(rename = "refresh_token")]
    refresh_token: String,
    #[serde(rename = "expires_in")]
    expires_in: Option<String>,
    #[serde(rename = "user_id")]
    user_id: Option<String>,
}

/// Refresh a Firebase session given a refresh token.
#[tauri::command]
async fn auth_firebase_refresh(app: tauri::AppHandle, refresh_token: String) -> AnyResult<SecurewaverAuthSession> {
    let firebase_web_api_key = (std::env::var("EMWAVER_FIREBASE_WEB_API_KEY").unwrap_or_default()).trim().to_string();
    if firebase_web_api_key.is_empty() {
        return Err("Missing EMWAVER_FIREBASE_WEB_API_KEY".to_string());
    }
    if refresh_token.trim().is_empty() {
        return Err("Missing refresh_token".to_string());
    }

    let url = format!(
        "https://securetoken.googleapis.com/v1/token?key={}",
        urlencoding::encode(firebase_web_api_key.trim())
    );

    let body = format!(
        "grant_type=refresh_token&refresh_token={}",
        urlencoding::encode(refresh_token.trim())
    );

    let http = reqwest::Client::new();
    let rr: FirebaseRefreshResponse = http
        .post(url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Firebase refresh failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Firebase refresh failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Firebase refresh decode failed: {e}"))?;

    // Keep profile fields (email/display name) if we already have them stored.
    let prev = session_store::get(&app).ok().flatten();

    let session = SecurewaverAuthSession {
        id_token: rr.id_token,
        refresh_token: rr.refresh_token,
        email: prev.as_ref().and_then(|p| p.email.clone()),
        display_name: prev.as_ref().and_then(|p| p.display_name.clone()),
        uid: rr.user_id.or_else(|| prev.as_ref().and_then(|p| p.uid.clone())),
    };

    // Persist rotated refresh_token.
    let _ = session_store::set(&app, &session);

    Ok(session)
}

fn main() {
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            update_mode_detect,
            dfu_provision_device,
            update_device_preserve_identity,
            detect_device,
            check_device_legit_run_mode,
            check_device_legit_update_mode,
            request_enter_update_mode,
            auth_session_get,
            auth_session_clear,
            auth_google_sign_in,
            auth_firebase_refresh
        ])
        .run(tauri::generate_context!())
        .expect("error while running SecureWaver");
}
