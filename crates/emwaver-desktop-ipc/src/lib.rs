use std::path::PathBuf;

use serde::{Deserialize, Serialize};

const IPC_DIRNAME: &str = "desktop-ipc";
const IPC_SOCK_NAME: &str = "ipc.sock";
#[cfg(windows)]
const IPC_PIPE_NAME: &str = r"\\.\pipe\emwaver-desktop-ipc";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcRequest {
    pub id: u64,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcResponse {
    pub id: u64,
    pub ok: bool,
    #[serde(default)]
    pub result: serde_json::Value,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcReady {
    pub pid: u32,
    pub version: String,
    pub ts_ms: u64,
}

pub fn ipc_root_dir() -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("XDG_RUNTIME_DIR") {
        let dir = dir.trim();
        if !dir.is_empty() {
            return Ok(PathBuf::from(dir).join("emwaver").join(IPC_DIRNAME));
        }
    }

    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    #[cfg(target_os = "macos")]
    {
        Ok(PathBuf::from(home)
            .join("Library")
            .join("Caches")
            .join("emwaver")
            .join(IPC_DIRNAME))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(PathBuf::from(home).join(".cache").join("emwaver").join(IPC_DIRNAME))
    }
}

#[cfg(unix)]
pub fn socket_path() -> Result<PathBuf, String> {
    Ok(ipc_root_dir()?.join(IPC_SOCK_NAME))
}

#[cfg(windows)]
pub fn pipe_name() -> &'static str {
    IPC_PIPE_NAME
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
