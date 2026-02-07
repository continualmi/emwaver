use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;
use tokio::time::sleep;
use tokio_tungstenite::tungstenite::Message;
use tracing::{error, info, warn};
use url::Url;

// NOTE: This is an initial scaffold. The intent is to match the existing
// backend WS protocol at /v1/ws and behave like the macOS RemoteControlHostService
// (headless UI state machine + script runtime), but on Linux.

#[derive(Debug, Clone)]
struct Config {
    backend_base_url: String,
    id_token: Option<String>,
    host_session_id: String,
}

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

    // /v1/ws
    base.set_path("/v1/ws");

    // query params
    {
        let mut q = base.query_pairs_mut();
        if let Some(tok) = &cfg.id_token {
            if !tok.is_empty() {
                q.append_pair("token", tok);
            }
        }
        q.append_pair("hostSessionId", &cfg.host_session_id);
    }

    // Convert http(s) -> ws(s)
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
        .unwrap_or_else(|| format!("linux-{}", uuid_like()));

    let cfg = Config {
        backend_base_url,
        id_token,
        host_session_id,
    };

    loop {
        if let Err(e) = connect_once(&cfg).await {
            warn!("ws connect loop error: {:#}", e);
        }
        sleep(Duration::from_secs(2)).await;
    }
}

async fn connect_once(cfg: &Config) -> Result<()> {
    let url = ws_url(cfg)?;
    info!("connecting ws: {url}");

    let (mut ws, _resp) = tokio_tungstenite::connect_async(url).await?;

    // hello
    let hello = Hello {
        r#type: "hello",
        role: "host",
        protocolVersion: 1,
        hostSessionId: &cfg.host_session_id,
    };
    ws.send(Message::Text(serde_json::to_string(&hello)?)).await?;

    // TODO: heartbeat loop to /v1/hosts/heartbeat
    // TODO: JS runtime init + script instance management
    // TODO: UI tree generation + ui.snapshot streaming

    while let Some(msg) = ws.next().await {
        let msg = msg?;
        match msg {
            Message::Text(s) => handle_incoming(cfg, &mut ws, &s).await?,
            Message::Binary(b) => {
                if let Ok(s) = String::from_utf8(b) {
                    handle_incoming(cfg, &mut ws, &s).await?;
                }
            }
            Message::Ping(p) => ws.send(Message::Pong(p)).await?,
            Message::Close(_) => break,
            _ => {}
        }
    }

    Ok(())
}

use futures_util::{SinkExt, StreamExt};

async fn handle_incoming(cfg: &Config, ws: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, text: &str) -> Result<()> {
    let inc: Incoming = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };

    match inc.r#type.as_str() {
        "hello.ack" => {
            info!("hello.ack: {}", inc.rest);
        }
        "host.attach" => {
            // Backend may forward this to the host. In the macOS host implementation,
            // the host sets a local UX flag and proceeds.
            info!("host.attach: {}", inc.rest);

            // Reply with host.attached (mirrors web controller expectations).
            let out = json!({
                "type": "host.attached",
                "hostSessionId": cfg.host_session_id,
            });
            ws.send(Message::Text(out.to_string())).await?;
        }
        "script.run" => {
            // TODO: start script runtime (QuickJS) + bind host APIs.
            // Then emit script.started and begin ui.snapshot streaming.
            info!("script.run (todo): {}", inc.rest);

            let out = json!({
                "type": "script.error",
                "hostSessionId": cfg.host_session_id,
                "error": "linux_host_not_implemented",
            });
            ws.send(Message::Text(out.to_string())).await?;
        }
        "ui.event" => {
            // TODO: dispatch to handler tokens in the headless UI state machine.
            info!("ui.event (todo): {}", inc.rest);
        }
        other => {
            // ignore unknown
            warn!("unknown msg type={other}");
        }
    }

    Ok(())
}

fn uuid_like() -> String {
    // no dependency; good enough for a host session id in early scaffolding.
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{ms}")
}
