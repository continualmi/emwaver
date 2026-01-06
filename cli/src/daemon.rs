/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;

use anyhow::{Context, Result, bail};
use base64::Engine;
use fs2::FileExt;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::runtime::Runtime;
use tokio::sync::mpsc;

use crate::bridge::{
    BridgeError, BridgeRequest, BridgeResponse, create_bridge_state, dispatch_request,
    emwaver_usb_midi_present, send_json_line,
};

#[cfg(unix)]
use tokio::net::{UnixListener, UnixStream};

const DEFAULT_SOCKET_FILENAME: &str = "emwaver.sock";

pub fn default_socket_path() -> Result<PathBuf> {
    if let Ok(value) = std::env::var("EMWAVER_DAEMON_SOCKET") {
        if !value.trim().is_empty() {
            return Ok(PathBuf::from(value));
        }
    }

    if let Ok(dir) = std::env::var("XDG_RUNTIME_DIR") {
        let dir = dir.trim();
        if !dir.is_empty() {
            return Ok(PathBuf::from(dir).join(DEFAULT_SOCKET_FILENAME));
        }
    }

    let home = std::env::var("HOME").context("HOME is not set")?;
    #[cfg(target_os = "macos")]
    {
        return Ok(PathBuf::from(home)
            .join("Library")
            .join("Caches")
            .join("emwaver")
            .join(DEFAULT_SOCKET_FILENAME));
    }
    #[cfg(not(target_os = "macos"))]
    {
        return Ok(PathBuf::from(home)
            .join(".cache")
            .join("emwaver")
            .join(DEFAULT_SOCKET_FILENAME));
    }
}

#[cfg(unix)]
fn trim_packet_text(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let trimmed = text.trim_matches(|c: char| c == '\0' || c == '\n' || c == '\r');
    if trimmed.is_empty() {
        text.to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(unix)]
pub(crate) async fn daemon_rpc(
    socket: &Path,
    req: BridgeRequest,
    overall_timeout: Duration,
) -> Result<serde_json::Value> {
    let mut stream = UnixStream::connect(socket)
        .await
        .with_context(|| format!("emwaver daemon not running ({})", socket.display()))?;

    let request = serde_json::to_vec(&req)?;
    stream.write_all(&request).await?;
    stream.write_all(b"\n").await?;
    stream.flush().await?;

    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    let deadline = tokio::time::Instant::now() + overall_timeout;
    loop {
        line.clear();
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            bail!("timeout waiting for daemon response");
        }
        let n = match tokio::time::timeout(remaining, reader.read_line(&mut line)).await {
            Ok(v) => v?,
            Err(_) => bail!("timeout waiting for daemon response"),
        };
        if n == 0 {
            bail!("daemon closed connection unexpectedly");
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let value: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if value.get("event").is_some() {
            continue;
        }
        if value.get("id").and_then(|v| v.as_u64()) != Some(req.id) {
            continue;
        }
        if value.get("ok").and_then(|v| v.as_bool()) != Some(true) {
            let msg = value
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("unknown error");
            bail!("{msg}");
        }
        return Ok(value.get("result").cloned().unwrap_or_default());
    }
}

fn ensure_parent_dir(path: &Path) -> Result<()> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    std::fs::create_dir_all(parent)
        .with_context(|| format!("failed to create daemon directory: {}", parent.display()))?;
    Ok(())
}

#[cfg(unix)]
fn daemon_start_lock_path(socket: &Path) -> PathBuf {
    let mut lock_path = socket.to_path_buf();
    lock_path.set_extension("lock");
    lock_path
}

#[cfg(unix)]
fn acquire_daemon_start_lock(socket: &Path) -> Result<std::fs::File> {
    let lock_path = daemon_start_lock_path(socket);
    ensure_parent_dir(&lock_path)?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&lock_path)
        .with_context(|| format!("failed to open daemon lock file: {}", lock_path.display()))?;
    file.lock_exclusive()
        .with_context(|| format!("failed to lock daemon lock file: {}", lock_path.display()))?;
    Ok(file)
}

#[cfg(unix)]
fn daemon_log_path(socket: &Path) -> PathBuf {
    let mut path = socket.to_path_buf();
    path.set_extension("log");
    path
}

#[cfg(unix)]
fn daemon_stdio_for_spawn(socket: &Path) -> Result<(Stdio, Stdio)> {
    let log_path = daemon_log_path(socket);
    ensure_parent_dir(&log_path)?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .with_context(|| format!("failed to open daemon log: {}", log_path.display()))?;
    let stdout = Stdio::from(file.try_clone().context("failed to clone daemon log handle")?);
    let stderr = Stdio::from(file);
    Ok((stdout, stderr))
}

#[cfg(unix)]
fn remove_stale_socket_if_present(socket: &Path) {
    if socket.exists() {
        let _ = std::fs::remove_file(socket);
    }
}

#[cfg(unix)]
pub fn daemon_run(socket: Option<PathBuf>) -> Result<()> {
    let socket = socket.unwrap_or(default_socket_path()?);
    ensure_parent_dir(&socket)?;

    if socket.exists() {
        let _ = std::fs::remove_file(&socket);
    }

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .context("failed to create async runtime")?;
    runtime.block_on(async { daemon_run_async(socket).await })
}

#[cfg(unix)]
async fn daemon_run_async(socket: PathBuf) -> Result<()> {
    let listener = UnixListener::bind(&socket)
        .with_context(|| format!("failed to bind daemon socket: {}", socket.display()))?;

    let state = create_bridge_state().await?;
    let shutdown = std::sync::Arc::new(tokio::sync::Notify::new());

    // Workaround for a real-world hotplug issue: on some platforms/backends, the MIDI port
    // enumeration only works reliably if the device is already present when the daemon starts.
    // If the daemon starts with the device unplugged, then the device is plugged in later,
    // `midir` may keep returning an empty list until the process restarts.
    //
    // To keep UX sane, detect the device appearing (VID/PID) and gracefully restart the daemon,
    // but only if we're not currently connected (avoid disrupting active sessions).
    let state_for_hotplug = state.clone();
    let shutdown_for_hotplug = shutdown.clone();
    tokio::spawn(async move {
        let mut last_present = emwaver_usb_midi_present().unwrap_or(false);
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;

            let present = match emwaver_usb_midi_present() {
                Ok(v) => v,
                Err(_) => {
                    // If we can't query presence, don't force restarts.
                    continue;
                }
            };

            if !last_present && present {
                let connected = state_for_hotplug.has_midi_connection().await;
                if !connected {
                    shutdown_for_hotplug.notify_waiters();
                    break;
                }
            }
            last_present = present;
        }
    });

    eprintln!("emwaver daemon listening on {}", socket.display());
    loop {
        tokio::select! {
            _ = shutdown.notified() => break,
            accept = listener.accept() => {
                let (stream, _) = accept.context("daemon accept failed")?;
                let state = state.clone();
                let shutdown = shutdown.clone();
                tokio::spawn(async move {
                    let _ = handle_client(stream, state, shutdown).await;
                });
            }
        }
    }

    let _ = std::fs::remove_file(&socket);
    Ok(())
}

#[cfg(unix)]
async fn handle_client(
    stream: UnixStream,
    state: std::sync::Arc<crate::bridge::BridgeState>,
    shutdown: std::sync::Arc<tokio::sync::Notify>,
) -> Result<()> {
    let (read_half, write_half) = stream.into_split();
    let mut reader = BufReader::new(read_half);

    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Vec<u8>>();

    let writer_task = tokio::spawn(async move {
        let mut out = write_half;
        while let Some(line) = out_rx.recv().await {
            if out.write_all(&line).await.is_err() {
                break;
            }
            let _ = out.flush().await;
        }
    });

    // Forward broadcast events to this client only if the client explicitly subscribes.
    //
    // Rationale: during sampler streaming, `rx_bytes` events can arrive at a very high rate.
    // If we forward events to every short-lived RPC connection (like the desktop app's
    // per-invoke Unix socket), it can delay the RPC response behind the event stream
    // and appear as a hang (e.g. "sample stop" never completes).
    let subscribed = Arc::new(AtomicBool::new(false));

    let mut events_rx = state.event_tx.subscribe();
    let out_tx_events = out_tx.clone();
    let subscribed_for_task = Arc::clone(&subscribed);
    let events_task = tokio::spawn(async move {
        loop {
            match events_rx.recv().await {
                Ok(line) => {
                    if subscribed_for_task.load(Ordering::Relaxed) {
                        let _ = out_tx_events.send(line);
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    let mut line = String::new();
    loop {
        line.clear();
        let bytes_read = reader
            .read_line(&mut line)
            .await
            .context("daemon read failed")?;
        if bytes_read == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let req: BridgeRequest = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // Transport-neutral subscription control for clients that want the async event stream
        // (rx_bytes / connected / disconnected / ota_status).
        if req.method == "events_subscribe" {
            subscribed.store(true, Ordering::Relaxed);
            let response = BridgeResponse {
                id: req.id,
                ok: true,
                result: Some(serde_json::json!({})),
                error: None,
            };
            let _ = send_json_line(&out_tx, &response);
            continue;
        }
        if req.method == "events_unsubscribe" {
            subscribed.store(false, Ordering::Relaxed);
            let response = BridgeResponse {
                id: req.id,
                ok: true,
                result: Some(serde_json::json!({})),
                error: None,
            };
            let _ = send_json_line(&out_tx, &response);
            continue;
        }

        if req.method == "shutdown" {
            let response = BridgeResponse {
                id: req.id,
                ok: true,
                result: Some(serde_json::json!({})),
                error: None,
            };
            let _ = send_json_line(&out_tx, &response);
            shutdown.notify_waiters();
            break;
        }

        let id = req.id;
        let response = match dispatch_request(state.clone(), req).await {
            Ok(result) => BridgeResponse {
                id,
                ok: true,
                result: Some(result),
                error: None,
            },
            Err(err) => BridgeResponse {
                id,
                ok: false,
                result: None,
                error: Some(BridgeError {
                    message: format!("{err:#}"),
                }),
            },
        };
        let _ = send_json_line(&out_tx, &response);
    }

    let _ = tokio::time::timeout(Duration::from_millis(200), writer_task).await;
    let _ = tokio::time::timeout(Duration::from_millis(200), events_task).await;
    Ok(())
}

#[cfg(unix)]
pub fn daemon_start(socket: Option<PathBuf>) -> Result<()> {
    let socket = socket.unwrap_or(default_socket_path()?);
    let _lock = acquire_daemon_start_lock(&socket)?;
    if daemon_is_running(Some(socket.clone()))? {
        println!("emwaver daemon already running ({})", socket.display());
        return Ok(());
    }

    ensure_parent_dir(&socket)?;
    remove_stale_socket_if_present(&socket);

    let exe = std::env::current_exe().context("failed to locate current executable")?;
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("daemon").arg("run").arg("--socket").arg(&socket);
    cmd.stdin(Stdio::null());
    let (stdout, stderr) = daemon_stdio_for_spawn(&socket)?;
    cmd.stdout(stdout);
    cmd.stderr(stderr);

    let _child = cmd.spawn().context("failed to start daemon")?;
    println!("emwaver daemon started ({})", socket.display());
    Ok(())
}

#[cfg(unix)]
pub fn ensure_daemon_running(socket: Option<PathBuf>) -> Result<PathBuf> {
    let socket = socket.unwrap_or(default_socket_path()?);
    let _lock = acquire_daemon_start_lock(&socket)?;
    if daemon_is_running(Some(socket.clone()))? {
        return Ok(socket);
    }

    ensure_parent_dir(&socket)?;
    remove_stale_socket_if_present(&socket);

    let exe = std::env::current_exe().context("failed to locate current executable")?;
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("daemon").arg("run").arg("--socket").arg(&socket);
    cmd.stdin(Stdio::null());
    let (stdout, stderr) = daemon_stdio_for_spawn(&socket)?;
    cmd.stdout(stdout);
    cmd.stderr(stderr);
    let _child = cmd.spawn().context("failed to start daemon")?;

    // Wait briefly for the socket to come up.
    use std::os::unix::net::UnixStream as StdUnixStream;
    for _ in 0..20 {
        if StdUnixStream::connect(&socket).is_ok() {
            return Ok(socket);
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    Ok(socket)
}

#[cfg(unix)]
fn daemon_socket_or_start(socket: Option<PathBuf>) -> Result<PathBuf> {
    ensure_daemon_running(socket)
}


#[cfg(unix)]
pub fn daemon_stop(socket: Option<PathBuf>) -> Result<()> {
    let socket = socket.unwrap_or(default_socket_path()?);
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async { daemon_stop_async(socket).await })
}

#[cfg(unix)]
async fn daemon_stop_async(socket: PathBuf) -> Result<()> {
    let mut stream = UnixStream::connect(&socket)
        .await
        .with_context(|| format!("emwaver daemon not running ({})", socket.display()))?;
    let request = serde_json::to_vec(&BridgeRequest {
        id: 1,
        method: "shutdown".to_string(),
        params: serde_json::json!({}),
    })?;
    stream.write_all(&request).await?;
    stream.write_all(b"\n").await?;
    stream.flush().await?;
    Ok(())
}

#[cfg(unix)]
pub fn daemon_is_running(socket: Option<PathBuf>) -> Result<bool> {
    let socket = socket.unwrap_or(default_socket_path()?);
    if !socket.exists() {
        return Ok(false);
    }
    use std::os::unix::net::UnixStream as StdUnixStream;
    Ok(StdUnixStream::connect(&socket).is_ok())
}

#[cfg(unix)]
pub fn daemon_status(socket: Option<PathBuf>, json: bool) -> Result<()> {
    let socket = socket.unwrap_or(default_socket_path()?);
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async { daemon_status_async(socket, json).await })
}

#[cfg(unix)]
async fn daemon_status_async(socket: PathBuf, json: bool) -> Result<()> {
    let mut stream = match UnixStream::connect(&socket).await {
        Ok(s) => s,
        Err(_) => {
            if json {
                println!("{}", serde_json::json!({ "running": false }));
            } else {
                println!("emwaver daemon: not running");
            }
            return Ok(());
        }
    };

    // Ask the daemon for connection status + connected devices.
    let req1 = serde_json::to_vec(&BridgeRequest {
        id: 1,
        method: "connection_status".to_string(),
        params: serde_json::json!({}),
    })?;
    stream.write_all(&req1).await?;
    stream.write_all(b"\n").await?;

    let req2 = serde_json::to_vec(&BridgeRequest {
        id: 2,
        method: "list_connected".to_string(),
        params: serde_json::json!({}),
    })?;
    stream.write_all(&req2).await?;
    stream.write_all(b"\n").await?;
    stream.flush().await?;

    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    let mut connected = None::<bool>;
    let mut devices = None::<serde_json::Value>;
    let mut seen1 = false;
    let mut seen2 = false;
    while !(seen1 && seen2) {
        line.clear();
        let n = tokio::time::timeout(Duration::from_secs(1), reader.read_line(&mut line))
            .await
            .unwrap_or(Ok(0))?;
        if n == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let value: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if value.get("event").is_some() {
            continue;
        }
        if value.get("ok").and_then(|v| v.as_bool()) != Some(true) {
            continue;
        }
        let id = value.get("id").and_then(|v| v.as_u64());
        let result = value.get("result").cloned().unwrap_or_default();
        match id {
            Some(1) => {
                connected = result.get("connected").and_then(|v| v.as_bool());
                seen1 = true;
            }
            Some(2) => {
                devices = result.get("devices").cloned();
                seen2 = true;
            }
            _ => {}
        }
    }

    if json {
        println!(
            "{}",
            serde_json::json!({
                "running": true,
                "socket": socket.display().to_string(),
                "connected": connected.unwrap_or(false),
                "devices": devices.unwrap_or_else(|| serde_json::json!([]))
            })
        );
        return Ok(());
    }

    println!(
        "emwaver daemon: running ({})",
        socket.display()
    );
    if connected.unwrap_or(false) {
        println!("device: connected");
    } else {
        println!("device: disconnected");
    }
    if let Some(devices) = devices {
        if let Some(first) = devices.as_array().and_then(|a| a.first()) {
            if let Some(addr) = first.get("address").and_then(|v| v.as_str()) {
                println!("address: {addr}");
            }
        }
    }
    Ok(())
}

#[cfg(unix)]
pub fn daemon_connect(socket: Option<PathBuf>, port: Option<String>) -> Result<()> {
    let socket = socket.unwrap_or(default_socket_path()?);
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async move {
        let params = serde_json::json!({
            "port_name": port,
        });
        let result = daemon_rpc(
            &socket,
            BridgeRequest {
                id: 1,
                method: "connect".to_string(),
                params,
            },
            Duration::from_millis(15_000),
        )
        .await?;
        let device = result.get("device").cloned().unwrap_or_else(|| serde_json::json!({}));
        println!("{device}");
        Ok(())
    })
}

#[cfg(unix)]
pub fn daemon_disconnect(socket: Option<PathBuf>) -> Result<()> {
    let socket = socket.unwrap_or(default_socket_path()?);
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async move {
        let _ = daemon_rpc(
            &socket,
            BridgeRequest {
                id: 1,
                method: "disconnect".to_string(),
                params: serde_json::json!({}),
            },
            Duration::from_secs(5),
        )
        .await?;
        Ok(())
    })
}

#[cfg(unix)]
pub fn daemon_connected(socket: Option<PathBuf>, json: bool) -> Result<()> {
    let socket = socket.unwrap_or(default_socket_path()?);
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async move {
        let result = daemon_rpc(
            &socket,
            BridgeRequest {
                id: 1,
                method: "list_connected".to_string(),
                params: serde_json::json!({}),
            },
            Duration::from_secs(5),
        )
        .await?;
        let devices = result.get("devices").cloned().unwrap_or_else(|| serde_json::json!([]));
        if json {
            println!("{devices}");
            return Ok(());
        }
        if let Some(arr) = devices.as_array() {
            if arr.is_empty() {
                println!("No devices connected.");
                return Ok(());
            }
            for dev in arr {
                let name = dev.get("name").and_then(|v| v.as_str()).unwrap_or("?");
                let address = dev.get("address").and_then(|v| v.as_str()).unwrap_or("?");
                println!("{name}\t{address}");
            }
        }
        Ok(())
    })
}

#[cfg(unix)]
pub fn daemon_midi_list(socket: Option<PathBuf>, json: bool) -> Result<()> {
    let socket = daemon_socket_or_start(socket)?;
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async move {
        let result = daemon_rpc(
            &socket,
            BridgeRequest {
                id: 1,
                method: "midi_list_ports".to_string(),
                params: serde_json::json!({}),
            },
            Duration::from_secs(5),
        )
        .await?;
        let ports = result.get("ports").cloned().unwrap_or_else(|| serde_json::json!([]));

        if json {
            println!("{ports}");
            return Ok(());
        }
        if let Some(arr) = ports.as_array() {
            if arr.is_empty() {
                println!("No USB devices found.");
                return Ok(());
            }
            for port in arr {
                if let Some(name) = port.as_str() {
                    println!("{name}");
                }
            }
        }
        Ok(())
    })
}

#[cfg(unix)]
pub fn daemon_midi_connect(socket: Option<PathBuf>, port: Option<String>, json: bool) -> Result<()> {
    let socket = daemon_socket_or_start(socket)?;
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async move {
        let params = serde_json::json!({ "port_name": port });
        let result = daemon_rpc(
            &socket,
            BridgeRequest {
                id: 1,
                method: "midi_connect".to_string(),
                params,
            },
            Duration::from_secs(10),
        )
        .await?;
        let device = result.get("device").cloned().unwrap_or_else(|| serde_json::json!({}));
        if json {
            println!("{device}");
        } else {
            println!("{device}");
        }
        Ok(())
    })
}

#[cfg(unix)]
pub fn daemon_midi_disconnect(socket: Option<PathBuf>) -> Result<()> {
    let socket = daemon_socket_or_start(socket)?;
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async move {
        let _ = daemon_rpc(
            &socket,
            BridgeRequest {
                id: 1,
                method: "midi_disconnect".to_string(),
                params: serde_json::json!({}),
            },
            Duration::from_secs(5),
        )
        .await?;
        Ok(())
    })
}

#[cfg(unix)]
pub fn daemon_midi_status(socket: Option<PathBuf>, json: bool) -> Result<()> {
    let socket = daemon_socket_or_start(socket)?;
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async move {
        let result = daemon_rpc(
            &socket,
            BridgeRequest {
                id: 1,
                method: "midi_status".to_string(),
                params: serde_json::json!({}),
            },
            Duration::from_secs(5),
        )
        .await?;
        if json {
            println!("{result}");
            return Ok(());
        }
        let connected = result.get("connected").and_then(|v| v.as_bool()).unwrap_or(false);
        if connected {
            let name = result
                .get("device_name")
                .and_then(|v| v.as_str())
                .unwrap_or("?");
            println!("connected: true");
            println!("port: {name}");
        } else {
            println!("connected: false");
        }
        Ok(())
    })
}

#[cfg(unix)]
pub fn daemon_cmd(
    socket: Option<PathBuf>,
    text: Vec<String>,
    timeout_ms: u64,
    packets: u32,
    verbose: bool,
    json: bool,
) -> Result<()> {
    let socket = daemon_socket_or_start(socket)?;
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async move {
        let text = text.join(" ");
        let params = serde_json::json!({
            "text": text,
            "timeout_ms": timeout_ms,
            "packets": packets
        });
        let result = daemon_rpc(
            &socket,
            BridgeRequest {
                id: 1,
                method: "send_command".to_string(),
                params,
            },
            Duration::from_millis(timeout_ms.saturating_add(5_000).max(1)),
        )
        .await?;

        let bytes_b64 = result
            .get("bytes_b64")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(bytes_b64.as_bytes())
            .unwrap_or_default();

        if json {
            println!(
                "{}",
                serde_json::json!({
                    "bytes_b64": bytes_b64,
                    "text": String::from_utf8_lossy(&bytes).to_string()
                })
            );
            return Ok(());
        }

        if verbose {
            let hex = bytes
                .iter()
                .map(|b| format!("{:02X}", b))
                .collect::<Vec<_>>()
                .join(" ");
            println!("hex:   {hex}");
            println!("ascii: {}", trim_packet_text(&bytes));
        } else {
            println!("{}", trim_packet_text(&bytes));
        }
        Ok(())
    })
}

#[cfg(unix)]
pub fn buffer_clear(socket: Option<PathBuf>) -> Result<()> {
    let socket = daemon_socket_or_start(socket)?;
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async move {
        let _ = daemon_rpc(
            &socket,
            BridgeRequest {
                id: 1,
                method: "buffer_clear".to_string(),
                params: serde_json::json!({}),
            },
            Duration::from_secs(5),
        )
        .await?;
        Ok(())
    })
}

#[cfg(unix)]
pub fn buffer_len(socket: Option<PathBuf>, json: bool) -> Result<()> {
    let socket = daemon_socket_or_start(socket)?;
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async move {
        let result = daemon_rpc(
            &socket,
            BridgeRequest {
                id: 1,
                method: "buffer_get_len_bytes".to_string(),
                params: serde_json::json!({}),
            },
            Duration::from_secs(5),
        )
        .await?;
        let len_bytes = result.get("len_bytes").and_then(|v| v.as_u64()).unwrap_or(0);
        if json {
            println!("{}", serde_json::json!({ "len_bytes": len_bytes }));
        } else {
            println!("{len_bytes}");
        }
        Ok(())
    })
}

#[cfg(unix)]
pub fn buffer_load_file(socket: Option<PathBuf>, path: PathBuf) -> Result<()> {
    let socket = daemon_socket_or_start(socket)?;
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async move {
        let params = serde_json::json!({ "path": path.to_string_lossy().to_string() });
        let result = daemon_rpc(
            &socket,
            BridgeRequest {
                id: 1,
                method: "buffer_set_bytes_file".to_string(),
                params,
            },
            Duration::from_secs(10),
        )
        .await?;
        let len_bytes = result.get("len_bytes").and_then(|v| v.as_u64()).unwrap_or(0);
        println!("{len_bytes}");
        Ok(())
    })
}

#[cfg(unix)]
pub fn buffer_save_file(socket: Option<PathBuf>, path: PathBuf) -> Result<()> {
    let socket = daemon_socket_or_start(socket)?;
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async move {
        let params = serde_json::json!({ "path": path.to_string_lossy().to_string() });
        let _ = daemon_rpc(
            &socket,
            BridgeRequest {
                id: 1,
                method: "buffer_save_bytes_file".to_string(),
                params,
            },
            Duration::from_secs(10),
        )
        .await?;
        Ok(())
    })
}

#[cfg(unix)]
pub fn buffer_transmit(socket: Option<PathBuf>) -> Result<()> {
    let socket = daemon_socket_or_start(socket)?;
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async move {
        let _ = daemon_rpc(
            &socket,
            BridgeRequest {
                id: 1,
                method: "buffer_transmit".to_string(),
                params: serde_json::json!({}),
            },
            Duration::from_secs(120),
        )
        .await?;
        Ok(())
    })
}

#[cfg(unix)]
pub fn sampler_start(
    socket: Option<PathBuf>,
    pin: i32,
) -> Result<()> {
    // Fire-and-forget: sampler streaming must not be contaminated by command-response framing.
    let cmd = format!("sample start --pin={pin}");
    daemon_cmd(socket, vec![cmd], 500, 0, false, false)
}

#[cfg(unix)]
pub fn sampler_stop(socket: Option<PathBuf>) -> Result<()> {
    daemon_cmd(socket, vec!["sample stop".to_string()], 500, 0, false, false)
}

#[cfg(unix)]
pub fn retransmit_start(
    socket: Option<PathBuf>,
    pin: i32,
    pwm: bool,
    freq: Option<i32>,
    duty: Option<i32>,
) -> Result<()> {
    // Fire-and-forget: retransmission reserves the notification channel for BS packets.
    let mut cmd = format!("transmit start --pin={pin}");
    if pwm {
        // Match desktop behavior: `--pwm` is a boolean flag (no explicit value).
        cmd.push_str(" --pwm");
        if let Some(freq) = freq {
            cmd.push_str(&format!(" --freq={freq}"));
        }
        if let Some(duty) = duty {
            cmd.push_str(&format!(" --duty={duty}"));
        }
    }
    daemon_cmd(socket, vec![cmd], 500, 0, false, false)
}

#[cfg(unix)]
pub fn retransmit_stop(socket: Option<PathBuf>) -> Result<()> {
    daemon_cmd(socket, vec!["transmit stop".to_string()], 500, 0, false, false)
}

#[cfg(not(unix))]
pub fn daemon_run(_: Option<PathBuf>) -> Result<()> {
    bail!("daemon is not supported on this platform yet")
}

#[cfg(not(unix))]
pub fn daemon_start(_: Option<PathBuf>) -> Result<()> {
    bail!("daemon is not supported on this platform yet")
}

#[cfg(not(unix))]
pub fn daemon_stop(_: Option<PathBuf>) -> Result<()> {
    bail!("daemon is not supported on this platform yet")
}

#[cfg(not(unix))]
pub fn daemon_is_running(_: Option<PathBuf>) -> Result<bool> {
    Ok(false)
}

#[cfg(not(unix))]
pub fn daemon_status(_: Option<PathBuf>, _: bool) -> Result<()> {
    bail!("daemon is not supported on this platform yet")
}

#[cfg(not(unix))]
pub fn daemon_connect(_: Option<PathBuf>, _: Option<String>) -> Result<()> {
    bail!("daemon is not supported on this platform yet")
}

#[cfg(not(unix))]
pub fn daemon_disconnect(_: Option<PathBuf>) -> Result<()> {
    bail!("daemon is not supported on this platform yet")
}

#[cfg(not(unix))]
pub fn daemon_connected(_: Option<PathBuf>, _: bool) -> Result<()> {
    bail!("daemon is not supported on this platform yet")
}

#[cfg(not(unix))]
pub fn daemon_cmd(_: Option<PathBuf>, _: Vec<String>, _: u64, _: u32, _: bool, _: bool) -> Result<()> {
    bail!("daemon is not supported on this platform yet")
}

#[cfg(not(unix))]
pub fn daemon_midi_list(_: Option<PathBuf>, _: bool) -> Result<()> {
    bail!("daemon is not supported on this platform yet")
}

#[cfg(not(unix))]
pub fn daemon_midi_connect(_: Option<PathBuf>, _: Option<String>, _: bool) -> Result<()> {
    bail!("daemon is not supported on this platform yet")
}

#[cfg(not(unix))]
pub fn daemon_midi_disconnect(_: Option<PathBuf>) -> Result<()> {
    bail!("daemon is not supported on this platform yet")
}

#[cfg(not(unix))]
pub fn daemon_midi_status(_: Option<PathBuf>, _: bool) -> Result<()> {
    bail!("daemon is not supported on this platform yet")
}

#[cfg(not(unix))]
pub fn ensure_daemon_running(_: Option<PathBuf>) -> Result<PathBuf> {
    bail!("daemon is not supported on this platform yet")
}

#[cfg(not(unix))]
pub fn buffer_clear(_: Option<PathBuf>) -> Result<()> {
    bail!("daemon is not supported on this platform yet")
}

#[cfg(not(unix))]
pub fn buffer_len(_: Option<PathBuf>, _: bool) -> Result<()> {
    bail!("daemon is not supported on this platform yet")
}

#[cfg(not(unix))]
pub fn buffer_load_file(_: Option<PathBuf>, _: PathBuf) -> Result<()> {
    bail!("daemon is not supported on this platform yet")
}

#[cfg(not(unix))]
pub fn buffer_save_file(_: Option<PathBuf>, _: PathBuf) -> Result<()> {
    bail!("daemon is not supported on this platform yet")
}

#[cfg(not(unix))]
pub fn buffer_transmit(_: Option<PathBuf>) -> Result<()> {
    bail!("daemon is not supported on this platform yet")
}

#[cfg(not(unix))]
pub fn sampler_start(_: Option<PathBuf>, _: i32) -> Result<()> {
    bail!("daemon is not supported on this platform yet")
}

#[cfg(not(unix))]
pub fn sampler_stop(_: Option<PathBuf>) -> Result<()> {
    bail!("daemon is not supported on this platform yet")
}

#[cfg(not(unix))]
pub fn retransmit_start(_: Option<PathBuf>, _: i32, _: bool, _: Option<i32>, _: Option<i32>) -> Result<()> {
    bail!("daemon is not supported on this platform yet")
}

#[cfg(not(unix))]
pub fn retransmit_stop(_: Option<PathBuf>) -> Result<()> {
    bail!("daemon is not supported on this platform yet")
}
