// SecureWaver - internal EMWaver provisioning UI

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use ed25519_dalek::SigningKey;
use rand_core::OsRng;
use serde::Serialize;
use std::{fs, path::Path};
use zeroize::Zeroize;

type AnyResult<T> = Result<T, String>;

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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![dfu_probe, root_generate_and_save])
        .run(tauri::generate_context!())
        .expect("error while running SecureWaver");
}
