// SecureWaver - internal EMWaver provisioning UI

use serde::Serialize;

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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![dfu_probe])
        .run(tauri::generate_context!())
        .expect("error while running SecureWaver");
}
