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
use std::time::Duration;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

#[cfg(unix)]
use tokio::net::UnixStream;

const DEFAULT_SOCKET_FILENAME: &str = "emwaver.sock";

#[derive(Debug, Deserialize, Serialize)]
pub struct RpcRequest {
    pub id: u64,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct RpcResponse {
    id: u64,
    ok: bool,
    #[serde(default)]
    result: serde_json::Value,
    #[serde(default)]
    error: Option<RpcError>,
    #[serde(default)]
    event: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RpcError {
    message: String,
}

pub fn default_socket_path() -> Result<PathBuf, String> {
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

    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
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

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("failed to create daemon directory {}: {e}", parent.display()))?;
    Ok(())
}

#[cfg(unix)]
pub fn is_socket_alive(socket: &Path) -> bool {
    use std::os::unix::net::UnixStream as StdUnixStream;
    if !socket.exists() {
        return false;
    }
    StdUnixStream::connect(socket).is_ok()
}

#[cfg(not(unix))]
pub fn is_socket_alive(_: &Path) -> bool {
    false
}

fn find_emwaver_exe() -> Option<PathBuf> {
    // Dev preference: when running the desktop app in debug (e.g. `npm run tauri dev`),
    // prefer the repo's own `cli/target/debug/emwaver` binary so local CLI changes are
    // picked up automatically.
    //
    // (Env vars remain available to override, but in debug builds we want the mono-repo
    // checkout to "just work" without extra setup.)
    if cfg!(debug_assertions) {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo_root = manifest_dir
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.to_path_buf());
        if let Some(root) = repo_root {
            let candidate = root.join("cli").join("target").join("debug").join("emwaver");
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }

    if let Ok(value) = std::env::var("EMWAVER_CLI_PATH") {
        let v = value.trim();
        if !v.is_empty() {
            return Some(PathBuf::from(v));
        }
    }

    if let Ok(value) = std::env::var("EMWAVER_DESKTOP_CLI_PATH") {
        let v = value.trim();
        if !v.is_empty() {
            return Some(PathBuf::from(v));
        }
    }

    // Dev fallback: repo checkout path, compiled in at build time.
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());
    if let Some(root) = repo_root {
        let candidate = root.join("cli").join("target").join("debug").join("emwaver");
        if candidate.exists() {
            return Some(candidate);
        }
    }

    None
}

#[cfg(unix)]
pub fn ensure_daemon_running(socket: &Path) -> Result<(), String> {
    if is_socket_alive(socket) {
        return Ok(());
    }

    ensure_parent_dir(socket)?;

    let Some(exe) = find_emwaver_exe() else {
        return Err("Could not locate `emwaver` CLI binary; set EMWAVER_CLI_PATH".to_string());
    };

    let mut cmd = std::process::Command::new(exe);
    // Spawn via `daemon start` so the CLI handles backgrounding/locking/logging, and so
    // the desktop app doesn't depend on foreground-mode `daemon run`.
    cmd.arg("daemon").arg("start").arg("--socket").arg(socket);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    cmd.spawn().map_err(|e| format!("failed to start emwaver daemon: {e}"))?;

    // Wait briefly for the socket to come up.
    for _ in 0..40 {
        if is_socket_alive(socket) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    Ok(())
}

#[cfg(not(unix))]
pub fn ensure_daemon_running(_: &Path) -> Result<(), String> {
    Err("EMWaver daemon is not supported on this platform yet".to_string())
}

#[cfg(unix)]
pub async fn rpc(
    socket: &Path,
    req: RpcRequest,
    overall_timeout: Duration,
) -> Result<serde_json::Value, String> {
    let mut stream = UnixStream::connect(socket)
        .await
        .map_err(|_| format!("emwaver daemon not running ({})", socket.display()))?;

    let request = serde_json::to_vec(&req).map_err(|e| format!("rpc encode failed: {e}"))?;
    stream
        .write_all(&request)
        .await
        .map_err(|e| format!("rpc write failed: {e}"))?;
    stream
        .write_all(b"\n")
        .await
        .map_err(|e| format!("rpc write failed: {e}"))?;
    stream.flush().await.ok();

    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    let deadline = tokio::time::Instant::now() + overall_timeout;
    loop {
        line.clear();
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err("timeout waiting for daemon response".to_string());
        }
        let n = match tokio::time::timeout(remaining, reader.read_line(&mut line)).await {
            Ok(v) => v.map_err(|e| format!("rpc read failed: {e}"))?,
            Err(_) => return Err("timeout waiting for daemon response".to_string()),
        };
        if n == 0 {
            return Err("daemon closed connection unexpectedly".to_string());
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let value: RpcResponse = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if value.event.is_some() {
            continue;
        }
        if value.id != req.id {
            continue;
        }
        if !value.ok {
            let msg = value
                .error
                .as_ref()
                .map(|e| e.message.clone())
                .unwrap_or_else(|| "unknown error".to_string());
            return Err(msg);
        }
        return Ok(value.result);
    }
}

#[cfg(not(unix))]
pub async fn rpc(_: &Path, _: RpcRequest, _: Duration) -> Result<serde_json::Value, String> {
    Err("EMWaver daemon is not supported on this platform yet".to_string())
}

pub fn encode_b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

pub fn decode_b64(s: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(s.as_bytes())
        .map_err(|e| format!("invalid base64: {e}"))
}
