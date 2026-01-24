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

mod git;
mod pty;
mod script_runtime;
mod desktop_ipc;

use serde::{Deserialize, Serialize};
use std::{
    env,
    fs,
    io,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
};
use tauri::{
    async_runtime::spawn_blocking,
    menu::{Menu, MenuItem, MenuItemKind, Submenu},
    Emitter, State,
};
use emwaver_dfu::{DfuDevice, DfuOpenOptions, DEFAULT_USB_PRODUCT_ID, DEFAULT_USB_VENDOR_ID};
use git::{
    git_commit, git_diff_contents, git_discard, git_push, git_stage, git_stage_all, git_status,
    git_unstage, git_unstage_all,
};
use pty::{PtyManager, PtyStartPayload, PtyStartResponse, PtyWritePayload, PtyResizePayload, PtyStopPayload};
use emwaver_device_core::bridge::{
    BridgeRequest, BridgeState, dispatch_request, send_packet_command_bytes, transmit_buffer_bytes,
    write_bytes,
};

static BUNDLED_FIRMWARE_BYTES: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/emwaver.bin"));

// ESP-IDF functionality removed - desktop app focuses on hardware interaction and scripts
const MENU_CLOSE_FOLDER_EVENT: &str = "menu-close-folder";
const MENU_NEW_PROJECT_EVENT: &str = "menu-new-project";
const MENU_OPEN_PROJECT_EVENT: &str = "menu-open-project";
const MENU_TOGGLE_EXPLORER_EVENT: &str = "menu-toggle-explorer";
const MENU_SHOW_EXPLORER_EVENT: &str = "menu-show-explorer";
const MENU_SHOW_SCRIPTS_EVENT: &str = "menu-show-scripts";
const MENU_SHOW_ISM_EVENT: &str = "menu-show-ism";
const MENU_SHOW_SAMPLER_EVENT: &str = "menu-show-sampler";
const MENU_SHOW_EMWAVER_EVENT: &str = "menu-show-emwaver";
const MENU_OPEN_FOLDER_EVENT: &str = "menu-open-folder";
const MENU_SAVE_FILE_EVENT: &str = "menu-save-file";
const MENU_INCREASE_LAYOUT_EVENT: &str = "menu-increase-layout";
const MENU_DECREASE_LAYOUT_EVENT: &str = "menu-decrease-layout";
const MENU_RESET_LAYOUT_EVENT: &str = "menu-reset-layout";

// ESP-IDF types and managers removed - desktop app doesn't need ESP-IDF toolchain

#[derive(Serialize)]
struct DirectoryEntry {
    name: String,
    path: String,
    kind: EntryKind,
    children: Option<Vec<DirectoryEntry>>,
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
enum EntryKind {
    File,
    Directory,
}

#[derive(Deserialize)]
struct ReadDirectoryPayload {
    path: String,
}

#[derive(Deserialize)]
struct ReadDirectoryChildrenPayload {
    path: String,
}

#[derive(Serialize)]
struct DirectoryChildEntry {
    name: String,
    path: String,
    kind: EntryKind,
}

#[derive(Deserialize)]
struct ReadFilePayload {
    path: String,
}

#[derive(Deserialize)]
struct ReadBinaryFilePayload {
    path: String,
}

#[derive(Deserialize)]
struct WriteFilePayload {
    path: String,
    content: String,
}

#[derive(Deserialize)]
struct WriteBinaryFilePayload {
    path: String,
    data: Vec<u8>,
}

#[derive(Deserialize)]
struct EnsureDirPayload {
    path: String,
}

#[derive(Clone, Serialize)]
struct SamplerCompressResponse {
    buffer_len_bytes: usize,
    time_values: Vec<f32>,
    data_values: Vec<f32>,
}

#[derive(Clone, Serialize)]
struct ReadPacketsResponse {
    data: Vec<u8>,
    ts_ms: Vec<u64>,
    next_packet_index: u64,
    available_packets: u64,
}

#[derive(Clone, Serialize)]
struct ReadMonitorResponse {
    data: Vec<u8>,
    ts_ms: Vec<u64>,
    kinds: Vec<u8>,
    next_packet_index: u64,
    available_packets: u64,
    packet_size: usize,
}

#[derive(Clone, Serialize)]
struct BufferPacket {
    data: Vec<u8>,
    ts_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MidiStatus {
    pub connected: bool,
    pub device_name: Option<String>,
}

#[derive(Deserialize)]
struct RemovePathPayload {
    path: String,
    recursive: Option<bool>,
}

#[derive(Deserialize)]
struct RenamePathPayload {
    from: String,
    to: String,
}

#[derive(Clone, Serialize)]
struct DfuProgressEvent {
    message: String,
    timestamp_ms: u64,
}

// Firmware task types removed - ESP-IDF build/flash functionality removed

#[tauri::command]
async fn read_directory(payload: ReadDirectoryPayload) -> Result<Vec<DirectoryEntry>, String> {
    let root = expand_path(&payload.path);
    if !root.exists() {
        return Err("Directory does not exist".into());
    }
    if !root.is_dir() {
        return Err("Path is not a directory".into());
    }

    spawn_blocking(move || list_directory(&root, &root))
        .await
        .map_err(|error| format!("Failed to read directory: {error}"))
        .and_then(|result| result)
}

#[tauri::command]
async fn read_directory_children(payload: ReadDirectoryChildrenPayload) -> Result<Vec<DirectoryChildEntry>, String> {
    let root = expand_path(&payload.path);
    if !root.exists() {
        return Err("Directory does not exist".into());
    }
    if !root.is_dir() {
        return Err("Path is not a directory".into());
    }

    spawn_blocking(move || list_directory_children(&root))
        .await
        .map_err(|error| format!("Failed to read directory: {error}"))
        .and_then(|result| result)
}

#[tauri::command]
async fn read_file(payload: ReadFilePayload) -> Result<String, String> {
    let path = expand_path(&payload.path);
    spawn_blocking(move || {
        fs::read_to_string(&path).map_err(|error| format!("Failed to read file: {error}"))
    })
    .await
    .map_err(|error| format!("Failed to read file: {error}"))
    .and_then(|result| result)
}

#[tauri::command]
async fn file_modified_ms(payload: ReadFilePayload) -> Result<i64, String> {
    let path = expand_path(&payload.path);
    spawn_blocking(move || {
        let metadata = fs::metadata(&path).map_err(|error| format!("Failed to stat file: {error}"))?;
        let modified = metadata
            .modified()
            .map_err(|error| format!("Failed to stat file: {error}"))?;
        let duration = modified
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| format!("Failed to stat file: {error}"))?;
        Ok::<i64, String>(duration.as_millis() as i64)
    })
    .await
    .map_err(|error| format!("Failed to stat file: {error}"))
    .and_then(|result| result)
}

#[derive(Deserialize)]
struct RunShellCommandPayload {
    command: String,
    cwd: Option<String>,
}

#[derive(Serialize)]
struct RunShellCommandResult {
    stdout: String,
    stderr: String,
    code: Option<i32>,
}

#[derive(Clone)]
struct DeviceState {
    bridge: Arc<BridgeState>,
    next_id: Arc<std::sync::atomic::AtomicU64>,
}

impl DeviceState {
    async fn rpc(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let id = self
            .next_id
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let req = BridgeRequest {
            id,
            method: method.to_string(),
            params,
        };
        dispatch_request(self.bridge.clone(), req)
            .await
            .map_err(|e| format!("{e:#}"))
    }
}

#[derive(Serialize)]
struct DeviceStatus {
    connected: bool,
    device_name: Option<String>,
}

#[tauri::command]
async fn device_get_status(state: State<'_, DeviceState>) -> Result<DeviceStatus, String> {
    let value = state
        .rpc("midi_status", serde_json::json!({}))
        .await?;
    Ok(DeviceStatus {
        connected: value
            .get("connected")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        device_name: value
            .get("device_name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    })
}

#[tauri::command]
async fn run_shell_command(payload: RunShellCommandPayload) -> Result<RunShellCommandResult, String> {
    let command = payload.command;
    let cwd = payload.cwd.map(|value| expand_path(&value));

    spawn_blocking(move || {
        let mut process = if cfg!(windows) {
            let mut cmd = Command::new("cmd");
            cmd.args(["/C", &command]);
            cmd
        } else {
            let mut cmd = Command::new("sh");
            cmd.args(["-lc", &command]);
            cmd
        };

        if let Some(dir) = cwd {
            process.current_dir(dir);
        }

        let output = process
            .output()
            .map_err(|error| format!("Failed to execute command: {error}"))?;

        Ok::<RunShellCommandResult, String>(RunShellCommandResult {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            code: output.status.code(),
        })
    })
    .await
    .map_err(|error| format!("Failed to execute command: {error}"))?
}

#[tauri::command]
async fn read_binary_file(payload: ReadBinaryFilePayload) -> Result<Vec<u8>, String> {
    let path = expand_path(&payload.path);
    spawn_blocking(move || fs::read(&path).map_err(|error| format!("Failed to read file: {error}")))
        .await
        .map_err(|error| format!("Failed to read file: {error}"))
        .and_then(|result| result)
}

#[tauri::command]
async fn write_file(payload: WriteFilePayload) -> Result<(), String> {
    let path = expand_path(&payload.path);
    let content = payload.content;
    spawn_blocking(move || {
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("Failed to create parent directory: {error}"))?;
            }
        }
        fs::write(&path, content).map_err(|error| format!("Failed to write file: {error}"))
    })
    .await
    .map_err(|error| format!("Failed to write file: {error}"))?
    .map_err(|error| format!("Failed to write file: {error}"))?;

    Ok(())
}

#[tauri::command]
async fn write_binary_file(payload: WriteBinaryFilePayload) -> Result<(), String> {
    let path = expand_path(&payload.path);
    let data = payload.data;
    spawn_blocking(move || {
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("Failed to create parent directory: {error}"))?;
            }
        }
        fs::write(&path, data).map_err(|error| format!("Failed to write file: {error}"))
    })
    .await
    .map_err(|error| format!("Failed to write file: {error}"))?
    .map_err(|error| format!("Failed to write file: {error}"))?;

    Ok(())
}

#[tauri::command]
async fn ensure_dir(payload: EnsureDirPayload) -> Result<(), String> {
    let path = expand_path(&payload.path);
    spawn_blocking(move || fs::create_dir_all(&path).map_err(|error| format!("Failed to create directory: {error}")))
        .await
        .map_err(|error| format!("Failed to create directory: {error}"))?
        .map_err(|error| format!("Failed to create directory: {error}"))?;
    Ok(())
}

// Sampler bitstream utilities are implemented in the shared buffer core.

#[tauri::command]
async fn buffer_clear(state: State<'_, DeviceState>) -> Result<(), String> {
    state
        .rpc("buffer_clear", serde_json::json!({}))
        .await?;
    Ok(())
}

#[tauri::command]
async fn sampler_buffer_clear(state: State<'_, DeviceState>) -> Result<(), String> {
    state
        .rpc("sampler_buffer_clear", serde_json::json!({}))
        .await?;
    Ok(())
}

#[tauri::command]
async fn buffer_get_counter(state: State<'_, DeviceState>) -> Result<u64, String> {
    let value = state
        .rpc("buffer_get_rx_counter", serde_json::json!({}))
        .await?;
    Ok(value.get("rx_counter").and_then(|v| v.as_u64()).unwrap_or(0))
}

#[tauri::command]
async fn buffer_set_counter(state: State<'_, DeviceState>, value: u64) -> Result<(), String> {
    state
        .rpc(
            "buffer_set_rx_counter",
            serde_json::json!({ "value": value }),
        )
        .await?;
    Ok(())
}

	#[tauri::command]
	async fn buffer_get_packet_count(state: State<'_, DeviceState>) -> Result<u64, String> {
	    let value = state
            .rpc("buffer_get_packet_count", serde_json::json!({}))
            .await?;
        Ok(value.get("packet_count").and_then(|v| v.as_u64()).unwrap_or(0))
	}

	#[tauri::command]
	async fn buffer_get_len_bytes(state: State<'_, DeviceState>) -> Result<usize, String> {
	    let value = state
            .rpc("buffer_get_len_bytes", serde_json::json!({}))
            .await?;
        Ok(value.get("len_bytes").and_then(|v| v.as_u64()).unwrap_or(0) as usize)
	}

#[tauri::command]
async fn buffer_read_packets_since(
    state: State<'_, DeviceState>,
    packet_index: u64,
    max_packets: usize,
) -> Result<ReadPacketsResponse, String> {
    let value = state
        .rpc(
            "buffer_read_packets_since",
            serde_json::json!({ "packet_index": packet_index, "max_packets": max_packets }),
        )
        .await?;

    let data_b64 = value.get("data_b64").and_then(|v| v.as_str()).unwrap_or("");
    let data = decode_b64(data_b64)?;
    let ts_ms = value
        .get("ts_ms")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_u64()).collect::<Vec<u64>>())
        .unwrap_or_default();
    let next_packet_index = value.get("next_packet_index").and_then(|v| v.as_u64()).unwrap_or(packet_index);
    let available_packets = value.get("available_packets").and_then(|v| v.as_u64()).unwrap_or(0);

    Ok(ReadPacketsResponse {
        data,
        ts_ms,
        next_packet_index,
        available_packets,
    })
}

#[tauri::command]
async fn buffer_next_packet(state: State<'_, DeviceState>) -> Result<Option<BufferPacket>, String> {
    let value = state
        .rpc("buffer_next_packet", serde_json::json!({}))
        .await?;
    let pkt = value.get("packet");
    if pkt.is_none() || pkt.is_some_and(|v| v.is_null()) {
        return Ok(None);
    }
    let pkt = pkt.unwrap();
    let data_b64 = pkt.get("data_b64").and_then(|v| v.as_str()).unwrap_or("");
    let data = decode_b64(data_b64)?;
    let ts_ms = pkt.get("ts_ms").and_then(|v| v.as_u64()).unwrap_or(0);
    Ok(Some(BufferPacket { data, ts_ms }))
}

#[tauri::command]
async fn buffer_read_tx_since(
    state: State<'_, DeviceState>,
    packet_index: u64,
    max_packets: usize,
) -> Result<ReadPacketsResponse, String> {
    let value = state
        .rpc(
            "buffer_read_tx_since",
            serde_json::json!({ "packet_index": packet_index, "max_packets": max_packets }),
        )
        .await?;

    let data_b64 = value.get("data_b64").and_then(|v| v.as_str()).unwrap_or("");
    let data = decode_b64(data_b64)?;
    let ts_ms = value
        .get("ts_ms")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_u64()).collect::<Vec<u64>>())
        .unwrap_or_default();
    let next_packet_index = value.get("next_packet_index").and_then(|v| v.as_u64()).unwrap_or(packet_index);
    let available_packets = value.get("available_packets").and_then(|v| v.as_u64()).unwrap_or(0);

    Ok(ReadPacketsResponse {
        data,
        ts_ms,
        next_packet_index,
        available_packets,
    })
}

#[tauri::command]
async fn transport_read_rx_since(
    state: State<'_, DeviceState>,
    packet_index: u64,
    max_packets: usize,
) -> Result<ReadMonitorResponse, String> {
    let value = state
        .rpc(
            "transport_read_rx_since",
            serde_json::json!({ "packet_index": packet_index, "max_packets": max_packets }),
        )
        .await?;

    let data_b64 = value.get("data_b64").and_then(|v| v.as_str()).unwrap_or("");
    let data = decode_b64(data_b64)?;
    let ts_ms = value
        .get("ts_ms")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_u64()).collect::<Vec<u64>>())
        .unwrap_or_default();
    let kinds = value
        .get("kinds")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_u64().map(|x| x as u8)).collect::<Vec<u8>>())
        .unwrap_or_default();
    let next_packet_index = value.get("next_packet_index").and_then(|v| v.as_u64()).unwrap_or(packet_index);
    let available_packets = value.get("available_packets").and_then(|v| v.as_u64()).unwrap_or(0);
    let packet_size = value.get("packet_size").and_then(|v| v.as_u64()).unwrap_or(128) as usize;

    Ok(ReadMonitorResponse {
        data,
        ts_ms,
        kinds,
        next_packet_index,
        available_packets,
        packet_size,
    })
}

#[tauri::command]
async fn transport_read_tx_since(
    state: State<'_, DeviceState>,
    packet_index: u64,
    max_packets: usize,
) -> Result<ReadMonitorResponse, String> {
    let value = state
        .rpc(
            "transport_read_tx_since",
            serde_json::json!({ "packet_index": packet_index, "max_packets": max_packets }),
        )
        .await?;

    let data_b64 = value.get("data_b64").and_then(|v| v.as_str()).unwrap_or("");
    let data = decode_b64(data_b64)?;
    let ts_ms = value
        .get("ts_ms")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_u64()).collect::<Vec<u64>>())
        .unwrap_or_default();
    let kinds = value
        .get("kinds")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_u64().map(|x| x as u8)).collect::<Vec<u8>>())
        .unwrap_or_default();
    let next_packet_index = value.get("next_packet_index").and_then(|v| v.as_u64()).unwrap_or(packet_index);
    let available_packets = value.get("available_packets").and_then(|v| v.as_u64()).unwrap_or(0);
    let packet_size = value.get("packet_size").and_then(|v| v.as_u64()).unwrap_or(128) as usize;

    Ok(ReadMonitorResponse {
        data,
        ts_ms,
        kinds,
        next_packet_index,
        available_packets,
        packet_size,
    })
}

#[tauri::command]
async fn command_read_since(
    state: State<'_, DeviceState>,
    packet_index: u64,
    max_packets: usize,
) -> Result<ReadMonitorResponse, String> {
    let value = state
        .rpc(
            "command_read_since",
            serde_json::json!({ "packet_index": packet_index, "max_packets": max_packets }),
        )
        .await?;

    let data_b64 = value.get("data_b64").and_then(|v| v.as_str()).unwrap_or("");
    let data = decode_b64(data_b64)?;
    let ts_ms = value
        .get("ts_ms")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_u64()).collect::<Vec<u64>>())
        .unwrap_or_default();
    let kinds = value
        .get("kinds")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_u64().map(|x| x as u8)).collect::<Vec<u8>>())
        .unwrap_or_default();
    let next_packet_index = value.get("next_packet_index").and_then(|v| v.as_u64()).unwrap_or(packet_index);
    let available_packets = value.get("available_packets").and_then(|v| v.as_u64()).unwrap_or(0);
    let packet_size = value.get("packet_size").and_then(|v| v.as_u64()).unwrap_or(64) as usize;

    Ok(ReadMonitorResponse {
        data,
        ts_ms,
        kinds,
        next_packet_index,
        available_packets,
        packet_size,
    })
}

#[tauri::command]
async fn buffer_get_bytes(state: State<'_, DeviceState>) -> Result<Vec<u8>, String> {
    let value = state
        .rpc("buffer_get_bytes", serde_json::json!({}))
        .await?;
    let data_b64 = value.get("data_b64").and_then(|v| v.as_str()).unwrap_or("");
    decode_b64(data_b64)
}

#[tauri::command]
async fn buffer_set_bytes(state: State<'_, DeviceState>, data: Vec<u8>) -> Result<usize, String> {
    let value = state
        .rpc(
            "buffer_set_bytes",
            serde_json::json!({ "data_b64": encode_b64(&data) }),
        )
        .await?;
    Ok(value.get("len_bytes").and_then(|v| v.as_u64()).unwrap_or(0) as usize)
}

#[tauri::command]
async fn buffer_set_invert_rx(state: State<'_, DeviceState>, enabled: bool) -> Result<(), String> {
    state
        .rpc(
            "buffer_set_invert_rx",
            serde_json::json!({ "enabled": enabled }),
        )
        .await?;
    Ok(())
}

#[tauri::command]
async fn buffer_compress_viewport(
    state: State<'_, DeviceState>,
    range_start: usize,
    range_end: usize,
    number_bins: usize,
) -> Result<SamplerCompressResponse, String> {
    let value = state
        .rpc(
            "buffer_compress_viewport",
            serde_json::json!({
                "range_start": range_start,
                "range_end": range_end,
                "number_bins": number_bins
            }),
        )
        .await?;

    Ok(SamplerCompressResponse {
        buffer_len_bytes: value.get("buffer_len_bytes").and_then(|v| v.as_u64()).unwrap_or(0) as usize,
        time_values: value
            .get("time_values")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_f64().map(|x| x as f32)).collect::<Vec<f32>>())
            .unwrap_or_default(),
        data_values: value
            .get("data_values")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_f64().map(|x| x as f32)).collect::<Vec<f32>>())
            .unwrap_or_default(),
    })
}

#[tauri::command]
async fn buffer_write_file(
    state: State<'_, DeviceState>,
    path: String,
) -> Result<(), String> {
    let path = expand_path(&path);
    let value = state
        .rpc("buffer_get_bytes", serde_json::json!({}))
        .await?;
    let data_b64 = value.get("data_b64").and_then(|v| v.as_str()).unwrap_or("");
    let bytes = decode_b64(data_b64)?;
    spawn_blocking(move || {
        fs::write(&path, bytes)
            .map_err(|error| format!("Failed to write file {}: {error}", path.display()))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|error| format!("Task failed: {error}"))?
}

#[tauri::command]
async fn buffer_build_signed_raw_timings(
    state: State<'_, DeviceState>,
) -> Result<String, String> {
    let value = state
        .rpc("buffer_build_signed_raw_timings", serde_json::json!({}))
        .await?;
    Ok(value.get("timings").and_then(|v| v.as_str()).unwrap_or("").to_string())
}

#[tauri::command]
async fn remove_path(payload: RemovePathPayload) -> Result<(), String> {
    let path = expand_path(&payload.path);
    let recursive = payload.recursive.unwrap_or(false);
    spawn_blocking(move || {
        if path.is_dir() {
            if recursive {
                fs::remove_dir_all(&path)
            } else {
                fs::remove_dir(&path)
            }
        } else if path.is_file() {
            fs::remove_file(&path)
        } else {
            return Ok(());
        }
        .map_err(|error| format!("Failed to remove path: {error}"))
    })
    .await
    .map_err(|error| format!("Failed to remove path: {error}"))?
    .map_err(|error| format!("Failed to remove path: {error}"))?;
    Ok(())
}

#[tauri::command]
async fn rename_path(payload: RenamePathPayload) -> Result<(), String> {
    let from = expand_path(&payload.from);
    let to = expand_path(&payload.to);
    spawn_blocking(move || fs::rename(&from, &to).map_err(|error| format!("Failed to rename path: {error}")))
        .await
        .map_err(|error| format!("Failed to rename path: {error}"))?
        .map_err(|error| format!("Failed to rename path: {error}"))?;
    Ok(())
}

#[derive(Deserialize)]
struct RevealInFinderPayload {
    path: String,
}

#[tauri::command]
async fn reveal_in_finder(payload: RevealInFinderPayload) -> Result<(), String> {
    let path = expand_path(&payload.path);
    let path_str = path
        .to_str()
        .ok_or_else(|| "Path contains invalid characters".to_string())?
        .to_string();
    spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        {
            Command::new("open")
                .arg("-R")
                .arg(&path_str)
                .output()
                .map_err(|error| format!("Failed to reveal in Finder: {error}"))?;
        }
        #[cfg(target_os = "windows")]
        {
            Command::new("explorer")
                .arg("/select,")
                .arg(&path_str)
                .output()
                .map_err(|error| format!("Failed to reveal in Explorer: {error}"))?;
        }
        #[cfg(target_os = "linux")]
        {
            let parent_path = Path::new(&path_str)
                .parent()
                .and_then(|p| p.to_str())
                .unwrap_or(&path_str);
            Command::new("xdg-open")
                .arg(parent_path)
                .output()
                .map_err(|error| format!("Failed to reveal in file manager: {error}"))?;
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Failed to reveal in Finder: {error}"))?
}

// ESP-IDF build/flash removed; IDE uses a minimal shell runner for local workflows.

#[tauri::command]
async fn pty_start(app: tauri::AppHandle, state: State<'_, Arc<PtyManager>>, payload: PtyStartPayload) -> Result<PtyStartResponse, String> {
    state
        .start(app, payload)
}

#[tauri::command]
async fn pty_write(state: State<'_, Arc<PtyManager>>, payload: PtyWritePayload) -> Result<(), String> {
    state.write(payload)
}

#[tauri::command]
async fn pty_resize(state: State<'_, Arc<PtyManager>>, payload: PtyResizePayload) -> Result<(), String> {
    state.resize(payload)
}

#[tauri::command]
async fn pty_stop(state: State<'_, Arc<PtyManager>>, payload: PtyStopPayload) -> Result<(), String> {
    state.stop(payload)
}


// ESP-IDF helper functions removed

fn list_directory(current: &Path, root: &Path) -> Result<Vec<DirectoryEntry>, String> {
    let mut entries = fs::read_dir(current)
        .map_err(|error| format!("Failed to read directory entries: {error}"))?
        .collect::<Result<Vec<_>, io::Error>>()
        .map_err(|error| format!("Unable to iterate directory: {error}"))?;

    entries.sort_by(|a, b| a.file_name().cmp(&b.file_name()));

    let mut directories = Vec::new();
    let mut files = Vec::new();

    for entry in entries {
        let path = entry.path();
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "Encountered invalid UTF-8 filename".to_string())?;

        if name == ".git" {
            continue;
        }

        if path.is_dir() {
            let children = list_directory(&path, root)?;
            directories.push(DirectoryEntry {
                name,
                path: relative_path(&path, root),
                kind: EntryKind::Directory,
                children: Some(children),
            });
        } else if path.is_file() {
            files.push(DirectoryEntry {
                name,
                path: relative_path(&path, root),
                kind: EntryKind::File,
                children: None,
            });
        }
    }

    directories.sort_by(|a, b| a.name.cmp(&b.name));
    files.sort_by(|a, b| a.name.cmp(&b.name));

    directories.extend(files);
    Ok(directories)
}

fn list_directory_children(root: &Path) -> Result<Vec<DirectoryChildEntry>, String> {
    let mut entries = fs::read_dir(root)
        .map_err(|error| format!("Failed to read directory entries: {error}"))?
        .collect::<Result<Vec<_>, io::Error>>()
        .map_err(|error| format!("Unable to iterate directory: {error}"))?;

    entries.sort_by(|a, b| a.file_name().cmp(&b.file_name()));

    let mut directories = Vec::new();
    let mut files = Vec::new();

    for entry in entries {
        let path = entry.path();
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "Encountered invalid UTF-8 filename".to_string())?;

        if name == ".git" {
            continue;
        }

        if path.is_dir() {
            directories.push(DirectoryChildEntry {
                name,
                path: path.to_string_lossy().replace('\\', "/"),
                kind: EntryKind::Directory,
            });
        } else if path.is_file() {
            files.push(DirectoryChildEntry {
                name,
                path: path.to_string_lossy().replace('\\', "/"),
                kind: EntryKind::File,
            });
        }
    }

    directories.sort_by(|a, b| a.name.cmp(&b.name));
    files.sort_by(|a, b| a.name.cmp(&b.name));

    directories.extend(files);
    Ok(directories)
}

fn relative_path(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn expand_path(path: &str) -> PathBuf {
    if let Some(stripped) = path.strip_prefix("~/") {
        if let Ok(home) = env::var("HOME") {
            return PathBuf::from(home).join(stripped);
        }
    } else if path == "~" {
        if let Ok(home) = env::var("HOME") {
            return PathBuf::from(home);
        }
    }

    PathBuf::from(path)
}

fn encode_b64(bytes: &[u8]) -> String {
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes)
}

fn decode_b64(s: &str) -> Result<Vec<u8>, String> {
    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, s.as_bytes())
        .map_err(|e| format!("invalid base64: {e}"))
}

// Device Commands (transport-agnostic once connected)
#[tauri::command]
async fn device_write(state: State<'_, DeviceState>, data: Vec<u8>) -> Result<(), String> {
    eprintln!(
        "[io] TX(write) {}B: {}",
        data.len(),
        String::from_utf8_lossy(&data).trim_end_matches('\0')
    );
    write_bytes(&state.bridge, data)
        .await
        .map_err(|e| format!("{e:#}"))?;
    Ok(())
}

#[tauri::command]
async fn device_send_packet(
    state: State<'_, DeviceState>,
    data: Vec<u8>,
    timeout_ms: u64,
    packets: u32,
) -> Result<Vec<u8>, String> {
    eprintln!(
        "[io] TX(cmd) {}B timeout={}ms packets={}: {}",
        data.len(),
        timeout_ms,
        packets,
        String::from_utf8_lossy(&data).trim_end_matches('\0')
    );
    let resp = match send_packet_command_bytes(&state.bridge, data, timeout_ms, packets).await {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[io] RX ERROR: {e:#}");
            return Err(format!("{e:#}"));
        }
    };
    let preview_ascii = String::from_utf8_lossy(&resp);
    let mut hex = String::new();
    for (i, b) in resp.iter().enumerate().take(32) {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{:02X}{}", b, if i + 1 == 32 { "" } else { " " });
    }
    eprintln!("[io] RX {}B hex[0..32]={} ascii={}", resp.len(), hex, preview_ascii.trim());
    Ok(resp)
}

#[tauri::command]
async fn device_transmit_buffer(state: State<'_, DeviceState>, data: Vec<u8>) -> Result<(), String> {
    if data.is_empty() {
        return Err("Buffer is empty".to_string());
    }
    transmit_buffer_bytes(&state.bridge, data)
        .await
        .map_err(|e| format!("{e:#}"))?;
    Ok(())
}

// MIDI Commands
#[tauri::command]
async fn midi_list_ports(state: State<'_, DeviceState>) -> Result<Vec<String>, String> {
    let value = state.rpc("midi_list_ports", serde_json::json!({})).await?;
    Ok(value
        .get("ports")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect::<Vec<String>>())
        .unwrap_or_default())
}

#[tauri::command]
async fn midi_connect(state: State<'_, DeviceState>, port_name: String) -> Result<(), String> {
    let _ = state
        .rpc(
            "midi_connect",
            serde_json::json!({ "port_name": port_name }),
        )
        .await?;
    Ok(())
}

#[tauri::command]
async fn midi_disconnect(state: State<'_, DeviceState>) -> Result<(), String> {
    state
        .rpc("midi_disconnect", serde_json::json!({}))
        .await?;
    Ok(())
}

#[tauri::command]
async fn midi_get_status(state: State<'_, DeviceState>) -> Result<MidiStatus, String> {
    let value = state
        .rpc("midi_status", serde_json::json!({}))
        .await?;
    Ok(MidiStatus {
        connected: value.get("connected").and_then(|v| v.as_bool()).unwrap_or(false),
        device_name: value
            .get("device_name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    })
}

// DFU Commands
#[tauri::command]
async fn dfu_is_connected() -> Result<bool, String> {
    spawn_blocking(move || {
        match DfuDevice::open_with_options(
            DEFAULT_USB_VENDOR_ID,
            DEFAULT_USB_PRODUCT_ID,
            DfuOpenOptions {
                alt_setting: None,
                verbose: false,
            },
        ) {
            Ok((_device, _discovery)) => Ok(true),
            Err(err) if err.contains("No DFU device found") => Ok(false),
            Err(err) => Err(err),
        }
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

fn emit_dfu_progress(app: &tauri::AppHandle, message: impl Into<String>) {
    let _ = app.emit(
        "dfu-progress",
        DfuProgressEvent {
            message: message.into(),
            timestamp_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        },
    );
}

// OTA helpers removed (MIDI-only runtime transport).
#[tauri::command]
async fn dfu_flash_embedded(app: tauri::AppHandle) -> Result<(), String> {
    let bytes = BUNDLED_FIRMWARE_BYTES;
    let app_handle = app.clone();

    spawn_blocking(move || {
        emit_dfu_progress(&app_handle, "Using bundled firmware".to_string());
        emit_dfu_progress(&app_handle, "Opening device in Update Mode...");
        let (mut device, _discovery) = DfuDevice::open_with_options(
            DEFAULT_USB_VENDOR_ID,
            DEFAULT_USB_PRODUCT_ID,
            DfuOpenOptions {
                alt_setting: None,
                verbose: false,
            },
        )?;
        device.flash(bytes, 0x0800_0000, |msg| emit_dfu_progress(&app_handle, msg))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

// ============================================================================
// Script Runtime Commands (embedded JS engine with direct USB access)
// ============================================================================

use script_runtime::{ScriptRuntime, ScriptEvent, ScriptCommand};
use std::sync::Mutex as StdMutex;
use tokio::sync::mpsc;

/// Global state for the active script runtime.
struct ScriptState {
    command_tx: StdMutex<Option<mpsc::UnboundedSender<ScriptCommand>>>,
}

impl Default for ScriptState {
    fn default() -> Self {
        Self {
            command_tx: StdMutex::new(None),
        }
    }
}

/// Execute a script script using the embedded JS engine (fast path - no IPC per command).
#[tauri::command]
async fn script_execute(
    app: tauri::AppHandle,
    device_state: tauri::State<'_, DeviceState>,
    script_state: tauri::State<'_, Arc<ScriptState>>,
    script: String,
    bootstrap: String,
) -> Result<(), String> {
    script_execute_impl(
        app,
        device_state.bridge.clone(),
        script_state.inner().clone(),
        script,
        bootstrap,
    )
    .await
}

async fn script_execute_impl(
    app: tauri::AppHandle,
    device: Arc<BridgeState>,
    script_state: Arc<ScriptState>,
    script: String,
    bootstrap: String,
) -> Result<(), String> {
    use tauri::Emitter;

    // Stop any existing script first
    {
        let mut tx_guard = script_state.command_tx.lock().map_err(|e| e.to_string())?;
        if let Some(tx) = tx_guard.take() {
            let _ = tx.send(ScriptCommand::Stop);
        }
    }

    // Create the runtime
    let (runtime, command_tx, mut event_rx) = ScriptRuntime::new(device, bootstrap);

    // Store command channel for callbacks
    {
        let mut tx_guard = script_state.command_tx.lock().map_err(|e| e.to_string())?;
        *tx_guard = Some(command_tx);
    }

    // Spawn the runtime in a blocking thread (Boa isn't async)
    let script_clone = script.clone();
    let _handle = tauri::async_runtime::spawn_blocking(move || runtime.execute(&script_clone));

    // Forward events to frontend
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            match &event {
                ScriptEvent::Render { ui } => {
                    let _ = app_clone.emit("script:render", ui);
                }
                ScriptEvent::Print { message } => {
                    let _ = app_clone.emit("script:print", message);
                }
                ScriptEvent::Error { message } => {
                    let _ = app_clone.emit("script:error", message);
                }
                ScriptEvent::Stopped => {
                    let _ = app_clone.emit("script:stopped", ());
                    break;
                }
            }
        }
    });

    // Wait briefly to catch immediate errors
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    Ok(())
}

/// Stop the currently running script.
#[tauri::command]
async fn script_stop(script_state: tauri::State<'_, Arc<ScriptState>>) -> Result<(), String> {
    script_stop_impl(script_state.inner().clone())?;
    Ok(())
}

fn script_stop_impl(script_state: Arc<ScriptState>) -> Result<(), String> {
    let tx_guard = script_state.command_tx.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = tx_guard.as_ref() {
        let _ = tx.send(ScriptCommand::Stop);
    }
    Ok(())
}

/// Send a callback event to the running script (e.g., button click).
#[tauri::command]
async fn script_callback(
    script_state: tauri::State<'_, Arc<ScriptState>>,
    token: String,
    data: serde_json::Value,
) -> Result<(), String> {
    script_callback_impl(script_state.inner().clone(), token, data)
}

fn script_callback_impl(
    script_state: Arc<ScriptState>,
    token: String,
    data: serde_json::Value,
) -> Result<(), String> {
    let tx_guard = script_state.command_tx.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = tx_guard.as_ref() {
        tx.send(ScriptCommand::Callback { token, data })
            .map_err(|e| format!("Failed to send callback: {e}"))?;
    } else {
        return Err("No running script".to_string());
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;
    use tauri_plugin_window_state::{AppHandleExt, StateFlags, WindowExt};

    let window_state_flags = StateFlags::SIZE | StateFlags::POSITION;

    let bridge = tauri::async_runtime::block_on(emwaver_device_core::bridge::create_bridge_state())
        .expect("failed to initialize device bridge");
    let device_state = DeviceState {
        bridge,
        next_id: Arc::new(std::sync::atomic::AtomicU64::new(1)),
    };
    let device_state_for_setup = device_state.clone();
    let script_state = Arc::new(ScriptState::default());
    let script_state_for_setup = script_state.clone();

    tauri::Builder::default()
        .setup(move |app| {
            let handle = app.handle();

            // Background device event pump (TX progress, flow control, etc.).
            let mut events_rx = device_state_for_setup.bridge.event_tx.subscribe();
            tauri::async_runtime::spawn(async move {
                let mut last_bs: u64 = 0;
                loop {
                    let line = match events_rx.recv().await {
                        Ok(bytes) => bytes,
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    };

                    let trimmed = std::str::from_utf8(&line).unwrap_or("").trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let value: serde_json::Value = match serde_json::from_str(trimmed) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    let Some(event) = value.get("event").and_then(|v| v.as_str()) else {
                        continue;
                    };

                    if event == "bs" {
                        let bs = value
                            .get("data")
                            .and_then(|d| d.get("value"))
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0);
                        last_bs = bs;
                        eprintln!("BS={bs}");
                        continue;
                    }

                    if event == "tx_progress" {
                        let data = value.get("data").cloned().unwrap_or_default();
                        let pct = data.get("pct").and_then(|v| v.as_u64()).unwrap_or(0);
                        let sent = data.get("sent_bytes").and_then(|v| v.as_u64()).unwrap_or(0);
                        let total = data.get("total_bytes").and_then(|v| v.as_u64()).unwrap_or(0);
                        let chunk = data.get("chunk_len").and_then(|v| v.as_u64()).unwrap_or(0);
                        let pkt = data.get("packet_size").and_then(|v| v.as_u64()).unwrap_or(0);
                        let period_ns = data.get("period_ns").and_then(|v| v.as_i64()).unwrap_or(0);
                        let _sleep_ns = data.get("sleep_ns").and_then(|v| v.as_i64()).unwrap_or(0);
                        let bs = data.get("bs").and_then(|v| v.as_u64()).unwrap_or(last_bs);
                        last_bs = bs;

                        let period_ms = (period_ns as f64) / 1_000_000.0;
                        eprintln!(
                            "TX {pct:>3}% {sent}/{total}B chunk={chunk}B pkt={pkt}B period={period_ms:.2}ms BS={bs}"
                        );
                    }
                }
            });

            desktop_ipc::spawn(handle.clone(), device_state_for_setup.clone(), script_state_for_setup.clone());

            let new_item = MenuItem::with_id(
                app,
                "menu-new-project",
                "New Project…",
                true,
                Some("CmdOrCtrl+Shift+N"),
            )?;
            let open_item = MenuItem::with_id(
                app,
                "menu-open-project",
                "Open Project…",
                true,
                Some("CmdOrCtrl+O"),
            )?;
            let file_new_item = MenuItem::with_id(
                app,
                "menu-file-new-project",
                "New Project…",
                true,
                Some("CmdOrCtrl+Shift+N"),
            )?;
            let file_open_item = MenuItem::with_id(
                app,
                "menu-file-open-project",
                "Open Project…",
                true,
                Some("CmdOrCtrl+O"),
            )?;
            let close_item = MenuItem::with_id(
                app,
                "menu-close-folder",
                "Close Folder",
                true,
                Some("CmdOrCtrl+W"),
            )?;
            let open_folder_item = MenuItem::with_id(
                app,
                "menu-open-folder",
                "Open Folder…",
                true,
                Some("CmdOrCtrl+Shift+O"),
            )?;
            let save_file_item = MenuItem::with_id(
                app,
                "menu-save-file",
                "Save",
                true,
                Some("CmdOrCtrl+S"),
            )?;
            let toggle_explorer_item = MenuItem::with_id(
                app,
                "menu-toggle-explorer",
                "Toggle Explorer",
                true,
                Some("CmdOrCtrl+B"),
            )?;
            let show_explorer_item = MenuItem::with_id(
                app,
                "menu-show-explorer",
                "Show Explorer",
                true,
                None::<&str>,
            )?;
            let show_scripts_item = MenuItem::with_id(
                app,
                "menu-show-scripts",
                "Show Scripts",
                true,
                None::<&str>,
            )?;
            let show_ism_item = MenuItem::with_id(
                app,
                "menu-show-ism",
                "Show ISM",
                true,
                None::<&str>,
            )?;
            let show_sampler_item = MenuItem::with_id(
                app,
                "menu-show-sampler",
                "Show Sampler",
                true,
                None::<&str>,
            )?;
            let show_emwaver_item = MenuItem::with_id(
                app,
                "menu-show-emwaver",
                "Show EMWaver",
                true,
                None::<&str>,
            )?;
            let increase_layout_item = MenuItem::with_id(
                app,
                "menu-increase-layout",
                "Zoom In",
                true,
                Some("CmdOrCtrl+Shift+="),
            )?;
            let decrease_layout_item = MenuItem::with_id(
                app,
                "menu-decrease-layout",
                "Zoom Out",
                true,
                Some("CmdOrCtrl+-"),
            )?;
            let reset_layout_item = MenuItem::with_id(
                app,
                "menu-reset-layout",
                "Reset Layout",
                true,
                Some("CmdOrCtrl+0"),
            )?;
            // Scripts menu items removed - no longer needed

            let mut close_item_added = false;
            let mut view_menu_added = false;
            let menu = Menu::default(&handle)?;
            if let Ok(items) = menu.items() {
                for item in items {
                    if let MenuItemKind::Submenu(submenu) = item {
                        if let Ok(label) = submenu.text() {
                            if label == "File" {
                                submenu.append(&file_new_item)?;
                                submenu.append(&file_open_item)?;
                                submenu.append(&open_folder_item)?;
                                submenu.append(&save_file_item)?;
                                submenu.append(&close_item)?;
                                close_item_added = true;
                            } else if label == "View" {
                                submenu.append(&increase_layout_item)?;
                                submenu.append(&decrease_layout_item)?;
                                submenu.append(&reset_layout_item)?;
                                submenu.append(&toggle_explorer_item)?;
                                submenu.append(&show_explorer_item)?;
                                submenu.append(&show_scripts_item)?;
                                submenu.append(&show_ism_item)?;
                                submenu.append(&show_sampler_item)?;
                                submenu.append(&show_emwaver_item)?;
                                view_menu_added = true;
                            }
                        }
                    }
                }
            }

            if !close_item_added {
                let file_menu = Submenu::new(app, "File", true)?;
                file_menu.append(&file_new_item)?;
                file_menu.append(&file_open_item)?;
                file_menu.append(&open_folder_item)?;
                file_menu.append(&save_file_item)?;
                file_menu.append(&close_item)?;
                menu.append(&file_menu)?;
            }

            if !view_menu_added {
                let view_menu = Submenu::new(app, "View", true)?;
                view_menu.append(&increase_layout_item)?;
                view_menu.append(&decrease_layout_item)?;
                view_menu.append(&reset_layout_item)?;
                view_menu.append(&toggle_explorer_item)?;
                view_menu.append(&show_explorer_item)?;
                view_menu.append(&show_scripts_item)?;
                view_menu.append(&show_ism_item)?;
                view_menu.append(&show_sampler_item)?;
                view_menu.append(&show_emwaver_item)?;
                menu.append(&view_menu)?;
            }

            let projects_menu = Submenu::new(app, "Projects", true)?;
            projects_menu.append(&new_item)?;
            projects_menu.append(&open_item)?;
            menu.append(&projects_menu)?;

            app.set_menu(menu)?;

            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.restore_state(window_state_flags);

                let app_handle = app.handle().clone();
                let save_seq_for_events =
                    std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
                let save_flags = window_state_flags;

                main_window.on_window_event(move |event| match event {
                    tauri::WindowEvent::CloseRequested { .. } => {
                        let _ = app_handle.save_window_state(save_flags);
                    }
                    tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                        let seq = save_seq_for_events
                            .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
                            + 1;
                        let app_handle = app_handle.clone();
                        let save_seq = save_seq_for_events.clone();
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(std::time::Duration::from_millis(750)).await;
                            if save_seq.load(std::sync::atomic::Ordering::SeqCst) == seq {
                                let _ = app_handle.save_window_state(save_flags);
                            }
                        });
                    }
                    _ => {}
                });

                let _ = main_window.show();
            }

            Ok(())
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "menu-close-folder" => {
                    let _ = app.emit(MENU_CLOSE_FOLDER_EVENT, ());
                }
                "menu-new-project" => {
                    let _ = app.emit(MENU_NEW_PROJECT_EVENT, ());
                }
                "menu-open-project" => {
                    let _ = app.emit(MENU_OPEN_PROJECT_EVENT, ());
                }
                "menu-file-new-project" => {
                    let _ = app.emit(MENU_NEW_PROJECT_EVENT, ());
                }
                "menu-file-open-project" => {
                    let _ = app.emit(MENU_OPEN_PROJECT_EVENT, ());
                }
                "menu-toggle-explorer" => {
                    let _ = app.emit(MENU_TOGGLE_EXPLORER_EVENT, ());
                }
                "menu-show-explorer" => {
                    let _ = app.emit(MENU_SHOW_EXPLORER_EVENT, ());
                }
                "menu-show-scripts" => {
                    let _ = app.emit(MENU_SHOW_SCRIPTS_EVENT, ());
                }
                "menu-show-ism" => {
                    let _ = app.emit(MENU_SHOW_ISM_EVENT, ());
                }
                "menu-show-sampler" => {
                    let _ = app.emit(MENU_SHOW_SAMPLER_EVENT, ());
                }
                "menu-show-emwaver" => {
                    let _ = app.emit(MENU_SHOW_EMWAVER_EVENT, ());
                }
                "menu-increase-layout" => {
                    let _ = app.emit(MENU_INCREASE_LAYOUT_EVENT, ());
                }
                "menu-decrease-layout" => {
                    let _ = app.emit(MENU_DECREASE_LAYOUT_EVENT, ());
                }
                "menu-reset-layout" => {
                    let _ = app.emit(MENU_RESET_LAYOUT_EVENT, ());
                }
                "menu-open-folder" => {
                    let _ = app.emit(MENU_OPEN_FOLDER_EVENT, ());
                }
                "menu-save-file" => {
                    let _ = app.emit(MENU_SAVE_FILE_EVENT, ());
                }
                _ => {}
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .skip_initial_state("main")
                .with_state_flags(window_state_flags)
                .build(),
        )
        .manage(device_state)
        .manage(script_state)
        .manage(Arc::new(PtyManager::new()))
		        .invoke_handler(tauri::generate_handler![
            read_directory,
            read_directory_children,
            read_file,
            file_modified_ms,
            read_binary_file,
            write_file,
            write_binary_file,
            ensure_dir,
                buffer_clear,
                sampler_buffer_clear,
                buffer_get_counter,
                buffer_set_counter,
                buffer_get_packet_count,
                buffer_get_len_bytes,
                buffer_read_packets_since,
            buffer_next_packet,
            buffer_read_tx_since,
            transport_read_rx_since,
            transport_read_tx_since,
            command_read_since,
            buffer_get_bytes,
            buffer_set_bytes,
            buffer_set_invert_rx,
            buffer_compress_viewport,
            buffer_write_file,
            buffer_build_signed_raw_timings,
            remove_path,
            rename_path,
            reveal_in_finder,
            run_shell_command,
            pty_start,
            pty_write,
            pty_resize,
            pty_stop,
            device_write,
            device_send_packet,
            device_transmit_buffer,
            midi_list_ports,
            midi_connect,
            midi_disconnect,
            midi_get_status,
            device_get_status,
	            dfu_is_connected,
	            dfu_flash_embedded,
	                git_status,
                git_diff_contents,
                git_stage,
                git_stage_all,
                git_unstage,
                git_unstage_all,
                git_discard,
                git_commit,
                git_push,
                script_execute,
                script_stop,
                script_callback
	        ])
	        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
