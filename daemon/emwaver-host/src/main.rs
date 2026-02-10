use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::time::Duration;
use tokio::time::sleep;
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, warn};
use url::Url;

mod config;
mod device;
mod engine;
mod heartbeat;
mod protocol;
mod ui_tree;

use config::Config;
use device::Device;
use engine::Engine;
use heartbeat::heartbeat_once;

// Headless host daemon (Model 1): headless script runtime + UI tree state machine.
// Matches the existing remote host protocol (`/v1/ws`) used by the GUI apps.

#[derive(Debug, Deserialize)]
struct Incoming {
    #[serde(default)]
    r#type: String,

    #[serde(flatten)]
    rest: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct Hello<'a> {
    r#type: &'a str,
    role: &'a str,
    protocolVersion: i32,
    hostSessionId: &'a str,
}

fn env_trim(key: &str) -> Option<String> {
    let v = std::env::var(key).ok()?;
    let t = v.trim().to_string();
    if t.is_empty() { None } else { Some(t) }
}

fn ws_url(cfg: &Config) -> Result<Url> {
    let mut base = Url::parse(&cfg.backend_base_url)
        .with_context(|| format!("invalid EMWAVER_BACKEND_URL: {}", cfg.backend_base_url))?;

    base.set_path("/v1/ws");

    {
        let mut q = base.query_pairs_mut();
        if let Some(tok) = &cfg.id_token {
            if !tok.is_empty() {
                q.append_pair("token", tok);
            }
        }
        q.append_pair("hostSessionId", &cfg.host_session_id);
    }

    let ws = match base.scheme() {
        "https" => {
            let mut u = base;
            u.set_scheme("wss").ok();
            u
        }
        "http" => {
            let mut u = base;
            u.set_scheme("ws").ok();
            u
        }
        "wss" | "ws" => base,
        other => anyhow::bail!("unsupported backend url scheme: {other}"),
    };

    Ok(ws)
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let backend_base_url = env_trim("EMWAVER_BACKEND_URL")
        .unwrap_or_else(|| "https://api.emwavers.com".to_string());

    // For now: allow starting without a token, but real auth/pairing will be required.
    let id_token = env_trim("EMWAVER_ID_TOKEN");

    let host_session_id = env_trim("EMWAVER_HOST_SESSION_ID")
        .unwrap_or_else(|| format!("daemon-{}", uuid_like()));

    let cfg = Config {
        backend_base_url,
        id_token,
        host_session_id,
    };

    // Load canonical bootstrap from the repo (dev mode).
    // NOTE: script runtime is currently stubbed; we still load the file so we can
    // re-enable it without changing daemon wiring.
    let bootstrap_path = env_trim("EMWAVER_BOOTSTRAP_PATH")
        .unwrap_or_else(|| "assets/default-scripts/script_bootstrap.emw".to_string());
    let bootstrap = fs::read_to_string(&bootstrap_path)
        .with_context(|| format!("failed to read bootstrap at {bootstrap_path}"))?;

    let device = Device::new();
    // Auto-connect to the EMWaver USB-MIDI port (best-effort).
    // If no ports are present yet, this will error and the process will exit.
    device.connect_auto()?;

    let engine = Engine::new(&bootstrap, device)?;

    loop {
        if let Err(e) = connect_once(&cfg, &engine).await {
            warn!("ws connect loop error: {:#}", e);
        }
        sleep(Duration::from_secs(2)).await;
    }
}

async fn connect_once(cfg: &Config, engine: &Engine) -> Result<()> {
    // Ensure presence exists before WS connect (backend requires hostSessionId to be heartbeated).
    heartbeat_once(cfg).await?;

    let url = ws_url(cfg)?;
    info!("connecting ws: {url}");

    let (mut ws, _resp) = tokio_tungstenite::connect_async(url.as_str()).await?;

    // hello
    let hello = Hello {
        r#type: "hello",
        role: "host",
        protocolVersion: 1,
        hostSessionId: &cfg.host_session_id,
    };
    ws.send(Message::Text(serde_json::to_string(&hello)?)).await?;

    // TODO: heartbeat loop to /v1/hosts/heartbeat

    let mut ui_rev: i32 = 0;
    let mut last_snapshot: String = String::new();

    while let Some(msg) = ws.next().await {
        let msg = msg?;
        match msg {
            Message::Text(s) => handle_incoming(cfg, engine, &mut ws, &s).await?,
            Message::Binary(b) => {
                if let Ok(s) = String::from_utf8(b) {
                    handle_incoming(cfg, engine, &mut ws, &s).await?;
                }
            }
            Message::Ping(p) => ws.send(Message::Pong(p)).await?,
            Message::Close(_) => break,
            _ => {}
        }

        // Stream UI snapshots on changes (Model 1 parity with macOS host).
        if let Some(root) = engine.latest_tree.lock().unwrap().clone() {
            let snap_obj = json!({
                "type": "ui.snapshot",
                "hostSessionId": cfg.host_session_id,
                "scriptInstanceId": "linux-script-1",
                "rev": ui_rev + 1,
                "root": root,
                "metadata": {},
            });
            let snap = snap_obj.to_string();
            if snap != last_snapshot {
                ui_rev += 1;
                last_snapshot = snap.clone();
                ws.send(Message::Text(snap)).await?;
            }
        }
    }

    Ok(())
}

async fn handle_incoming(
    cfg: &Config,
    engine: &Engine,
    ws: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    text: &str,
) -> Result<()> {
    let inc: Incoming = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };

    match inc.r#type.as_str() {
        "hello.ack" => {
            info!("hello.ack: {}", inc.rest);
        }
        "host.attach" => {
            // Align with backend behavior: backend sends host.attached to web.
            // Host does not need to reply.
            info!("host.attach");
        }
        "script.run" => {
            let source = inc
                .rest
                .get("source")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if source.trim().is_empty() {
                let out = json!({
                    "type": "script.error",
                    "hostSessionId": cfg.host_session_id,
                    "error": "missing_source",
                });
                ws.send(Message::Text(out.to_string())).await?;
                return Ok(());
            }

            engine.run_script(source)?;

            let out = json!({
                "type": "script.started",
                "hostSessionId": cfg.host_session_id,
                "scriptInstanceId": "linux-script-1",
                "name": inc.rest.get("name").and_then(|v| v.as_str()).unwrap_or(""),
            });
            ws.send(Message::Text(out.to_string())).await?;
        }
        "ui.event" => {
            let script_instance_id = inc.rest.get("scriptInstanceId").and_then(|v| v.as_str()).unwrap_or("");
            if script_instance_id != "linux-script-1" {
                return Ok(());
            }
            let target_node_id = inc.rest.get("targetNodeId").and_then(|v| v.as_str()).unwrap_or("");
            let name = inc.rest.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if target_node_id.is_empty() || name.is_empty() {
                return Ok(());
            }

            let tree_opt = engine.latest_tree.lock().unwrap().clone();
            let Some(tree) = tree_opt else { return Ok(()); };
            let Some(node) = tree.find_node(target_node_id) else { return Ok(()); };
            let Some(token) = node.handler_token(name) else { return Ok(()); };

            let payload = inc.rest.get("payload").cloned().unwrap_or(serde_json::Value::Null);
            let mut args: Vec<serde_json::Value> = vec![];
            if matches!(name, "change" | "select" | "submit") {
                if let Some(v) = payload.get("value") {
                    args.push(v.clone());
                }
            }

            let _ = engine.dispatch_ui_event(token, args);
        }
        other => {
            warn!("unknown msg type={other}");
        }
    }

    Ok(())
}

fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{ms}")
}
