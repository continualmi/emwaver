use std::fs;
use std::path::Path;
use std::sync::Arc;

use emwaver_desktop_ipc::{IpcReady, IpcRequest, IpcResponse};

pub fn spawn(app: tauri::AppHandle, device: super::DeviceState, wavelet_state: Arc<super::WaveletState>) {
    tauri::async_runtime::spawn(async move {
        if let Err(err) = run(app, device, wavelet_state).await {
            eprintln!("[desktop_ipc] stopped: {err}");
        }
    });
}

async fn run(
    app: tauri::AppHandle,
    device: super::DeviceState,
    wavelet_state: Arc<super::WaveletState>,
) -> Result<(), String> {
    let inbox = emwaver_desktop_ipc::inbox_dir()?;
    let outbox = emwaver_desktop_ipc::outbox_dir()?;
    let ready = emwaver_desktop_ipc::ready_path()?;

    ensure_dir(&inbox)?;
    ensure_dir(&outbox)?;

    let mut ticker = tokio::time::interval(std::time::Duration::from_millis(100));
    let mut last_ready_ms: u64 = 0;

    loop {
        ticker.tick().await;

        let now = emwaver_desktop_ipc::now_ms();
        if now.saturating_sub(last_ready_ms) >= 500 {
            write_json_atomic(
                &ready,
                &IpcReady {
                    pid: std::process::id(),
                    version: env!("CARGO_PKG_VERSION").to_string(),
                    ts_ms: now,
                },
            )?;
            last_ready_ms = now;
        }

        let entries = match fs::read_dir(&inbox) {
            Ok(v) => v,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let req_bytes = match fs::read(&path) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let req: IpcRequest = match serde_json::from_slice(&req_bytes) {
                Ok(v) => v,
                Err(_) => {
                    let _ = fs::remove_file(&path);
                    continue;
                }
            };
            let _ = fs::remove_file(&path);

            let (ok, result, error) = handle_request(app.clone(), device.clone(), wavelet_state.clone(), req.clone()).await;
            let resp = IpcResponse {
                id: req.id,
                ok,
                result,
                error,
            };

            let resp_path = emwaver_desktop_ipc::response_path(req.id)?;
            write_json_atomic(&resp_path, &resp)?;
        }
    }
}

async fn handle_request(
    app: tauri::AppHandle,
    device: super::DeviceState,
    wavelet_state: Arc<super::WaveletState>,
    req: IpcRequest,
) -> (bool, serde_json::Value, Option<String>) {
    match req.method.as_str() {
        "ping" => (true, serde_json::json!({}), None),
        "wavelet_execute" => {
            let script = req
                .params
                .get("script")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let bootstrap = req
                .params
                .get("bootstrap")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            match super::wavelet_execute_impl(app, device.bridge.clone(), wavelet_state, script, bootstrap).await {
                Ok(()) => (true, serde_json::json!({}), None),
                Err(e) => (false, serde_json::Value::Null, Some(e)),
            }
        }
        "wavelet_stop" => match super::wavelet_stop_impl(wavelet_state) {
            Ok(()) => (true, serde_json::json!({}), None),
            Err(e) => (false, serde_json::Value::Null, Some(e)),
        },
        "wavelet_callback" => {
            let token = req
                .params
                .get("token")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let data = req.params.get("data").cloned().unwrap_or(serde_json::Value::Null);
            match super::wavelet_callback_impl(wavelet_state, token, data) {
                Ok(()) => (true, serde_json::json!({}), None),
                Err(e) => (false, serde_json::Value::Null, Some(e)),
            }
        }
        other => match device.rpc(other, req.params).await {
            Ok(v) => (true, v, None),
            Err(e) => (false, serde_json::Value::Null, Some(e)),
        },
    }
}

fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("failed to create {}: {e}", path.display()))
}

fn write_json_atomic<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    let bytes = serde_json::to_vec(value).map_err(|e| format!("failed to encode json: {e}"))?;
    fs::write(&tmp, bytes).map_err(|e| format!("failed to write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("failed to rename {}: {e}", path.display()))?;
    Ok(())
}
