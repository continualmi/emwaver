use anyhow::{Context, Result};
use serde_json::json;

use crate::config::Config;

fn platform_name() -> &'static str {
    #[cfg(target_os = "macos")]
    { "macos" }
    #[cfg(target_os = "linux")]
    { "linux" }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    { "unknown" }
}

pub async fn heartbeat_once(cfg: &Config) -> Result<()> {
    let tok = cfg
        .id_token
        .as_ref()
        .map(|s| s.as_str())
        .unwrap_or("");
    if tok.trim().is_empty() {
        anyhow::bail!("missing EMWAVER_ID_TOKEN (required for heartbeat/ws)");
    }

    let url = format!("{}/v1/hosts/heartbeat", cfg.backend_base_url.trim_end_matches('/'));

    let client = reqwest::Client::new();
    let res = client
        .post(url)
        .bearer_auth(tok)
        .json(&json!({
            "host_session_id": cfg.host_session_id,
            "platform": platform_name(),
            "device_name": hostname::get().ok().and_then(|s| s.into_string().ok()).unwrap_or_default(),
            "app_version": env!("CARGO_PKG_VERSION"),
            "capabilities": {
                "headless": true,
                "remote_control": true
            },
            "status": {}
        }))
        .send()
        .await
        .context("heartbeat request failed")?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        anyhow::bail!("heartbeat failed: {status} {body}");
    }

    Ok(())
}
