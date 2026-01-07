use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use anyhow::{Context, Result, bail};
use base64::Engine as _;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn next_id() -> u64 {
    let t = emwaver_desktop_ipc::now_ms();
    let seq = NEXT_ID.fetch_add(1, Ordering::Relaxed) & 0xFFFF;
    (t << 16) | seq
}

pub fn desktop_ready(max_age_ms: u64) -> Result<emwaver_desktop_ipc::IpcReady> {
    let ready_path =
        emwaver_desktop_ipc::ready_path().map_err(anyhow::Error::msg)?;
    let bytes = std::fs::read(&ready_path)
        .with_context(|| format!("EMWaver Desktop is not running (expected {})", ready_path.display()))?;
    let ready: emwaver_desktop_ipc::IpcReady = serde_json::from_slice(&bytes)
        .with_context(|| format!("invalid desktop ready file ({})", ready_path.display()))?;
    let now = emwaver_desktop_ipc::now_ms();
    if now.saturating_sub(ready.ts_ms) > max_age_ms {
        bail!("EMWaver Desktop is not responding (open the Desktop app and try again)");
    }
    Ok(ready)
}

pub fn rpc(
    method: &str,
    params: serde_json::Value,
    timeout: Duration,
) -> Result<emwaver_desktop_ipc::IpcResponse> {
    let _ = desktop_ready(2_000)?;

    let id = next_id();
    let request = emwaver_desktop_ipc::IpcRequest {
        id,
        method: method.to_string(),
        params,
    };

    let inbox_path = emwaver_desktop_ipc::request_path(id).map_err(anyhow::Error::msg)?;
    let outbox_path = emwaver_desktop_ipc::response_path(id).map_err(anyhow::Error::msg)?;
    let _ = std::fs::remove_file(&outbox_path);

    if let Some(parent) = inbox_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create inbox dir {}", parent.display()))?;
    }
    if let Some(parent) = outbox_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create outbox dir {}", parent.display()))?;
    }

    let tmp = inbox_path.with_extension("tmp");
    let bytes = serde_json::to_vec(&request).context("failed to encode request")?;
    std::fs::write(&tmp, bytes).context("failed to write request")?;
    std::fs::rename(&tmp, &inbox_path).context("failed to submit request")?;

    let deadline = std::time::Instant::now() + timeout;
    loop {
        if let Ok(bytes) = std::fs::read(&outbox_path) {
            let resp: emwaver_desktop_ipc::IpcResponse = serde_json::from_slice(&bytes)
                .context("invalid response")?;
            let _ = std::fs::remove_file(&outbox_path);
            return Ok(resp);
        }
        if std::time::Instant::now() >= deadline {
            bail!("timeout waiting for Desktop response ({method})");
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

pub fn rpc_ok(method: &str, params: serde_json::Value, timeout: Duration) -> Result<serde_json::Value> {
    let resp = rpc(method, params, timeout)?;
    if !resp.ok {
        bail!("{}", resp.error.unwrap_or_else(|| "unknown error".to_string()));
    }
    Ok(resp.result)
}

pub fn decode_b64(s: &str) -> Result<Vec<u8>> {
    base64::engine::general_purpose::STANDARD
        .decode(s.as_bytes())
        .context("invalid base64")
}
