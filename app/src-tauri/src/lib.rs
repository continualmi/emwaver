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

mod firmware;
mod git;
mod daemon_client;
mod pty;

use serde::{Deserialize, Serialize};
use std::{
    env,
    fs,
    io,
    io::Write as _,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
    time::Duration,
};
use tauri::{
    async_runtime::spawn_blocking,
    menu::{Menu, MenuItem, MenuItemKind, Submenu},
    Emitter, State,
};
use tokio::io::{AsyncBufReadExt, BufReader};
use emw::dfu::{DfuDevice, DfuOpenOptions, DEFAULT_USB_PRODUCT_ID, DEFAULT_USB_VENDOR_ID};
use firmware::{firmware_build, firmware_flash};
use git::{
    git_commit, git_diff_contents, git_discard, git_push, git_stage, git_stage_all, git_status,
    git_unstage, git_unstage_all,
};
use pty::{PtyManager, PtyStartPayload, PtyStartResponse, PtyWritePayload, PtyResizePayload, PtyStopPayload};
use daemon_client::{RpcRequest, decode_b64, encode_b64};

const ESP32_STOCK_FIRMWARE_BIN: &[u8] = include_bytes!("../resources/ota/emwaveresp.bin");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EmbeddedFirmware {
    Ism,
    Gpio,
    Ir,
    Rfid,
}

impl EmbeddedFirmware {
    fn from_str(value: &str) -> Option<Self> {
        match value {
            "ism" => Some(Self::Ism),
            "gpio" => Some(Self::Gpio),
            "ir" => Some(Self::Ir),
            "rfid" => Some(Self::Rfid),
            _ => None,
        }
    }

    fn bytes(self) -> &'static [u8] {
        match self {
            Self::Ism => include_bytes!("../resources/dfu/ism.dfu"),
            Self::Gpio => include_bytes!("../resources/dfu/gpio.dfu"),
            Self::Ir => include_bytes!("../resources/dfu/ir.dfu"),
            Self::Rfid => include_bytes!("../resources/dfu/rfid.dfu"),
        }
    }
}

#[derive(Deserialize)]
struct CreateProjectPayload {
    name: String,
    location: String,
    target: String,
    components: Vec<String>,
    stm32_firmware: Option<String>,
}

#[derive(Serialize)]
struct CreateProjectResponse {
    path: String,
}

// ESP-IDF functionality removed - desktop app focuses on hardware interaction and wavelets
const MENU_CLOSE_FOLDER_EVENT: &str = "menu-close-folder";
const MENU_NEW_PROJECT_EVENT: &str = "menu-new-project";
const MENU_OPEN_PROJECT_EVENT: &str = "menu-open-project";
const MENU_TOGGLE_EXPLORER_EVENT: &str = "menu-toggle-explorer";
const MENU_SHOW_EXPLORER_EVENT: &str = "menu-show-explorer";
const MENU_SHOW_WAVELETS_EVENT: &str = "menu-show-wavelets";
const MENU_SHOW_ISM_EVENT: &str = "menu-show-ism";
const MENU_SHOW_SAMPLER_EVENT: &str = "menu-show-sampler";
const MENU_SHOW_EMWAVER_EVENT: &str = "menu-show-emwaver";
const MENU_SHOW_IDE_EVENT: &str = "menu-show-ide";
const MENU_INCREASE_LAYOUT_EVENT: &str = "menu-increase-layout";
const MENU_DECREASE_LAYOUT_EVENT: &str = "menu-decrease-layout";
const MENU_RESET_LAYOUT_EVENT: &str = "menu-reset-layout";
const MENU_IDE_OPEN_FOLDER_EVENT: &str = "menu-ide-open-folder";
const MENU_IDE_SAVE_FILE_EVENT: &str = "menu-ide-save-file";
const MENU_IDE_FIRMWARE_BUILD_EVENT: &str = "menu-ide-firmware-build";
const MENU_IDE_FIRMWARE_FLASH_EVENT: &str = "menu-ide-firmware-flash";
const MENU_IDE_FIRMWARE_BUILD_FLASH_EVENT: &str = "menu-ide-firmware-build-flash";

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
struct BufferPacket {
    data: Vec<u8>,
    ts_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BLEStatus {
    pub connected: bool,
    pub scanning: bool,
    pub device_name: Option<String>,
    pub device_address: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct USBStatus {
    pub connected: bool,
    pub device_path: Option<String>,
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
async fn create_project(payload: CreateProjectPayload) -> Result<CreateProjectResponse, String> {
    let project_name = payload.name.trim();
    if project_name.is_empty() {
        return Err("Project name is required".into());
    }

    let target = parse_init_target(&payload.target)?;
    let components = parse_init_components(&payload.components)?;
    let stm32_firmware = parse_init_stm32_firmware(payload.stm32_firmware.as_deref())?;

    let base_path = expand_path(&payload.location);
    if !base_path.exists() {
        fs::create_dir_all(&base_path)
            .map_err(|error| format!("Unable to create base directory: {error}"))?;
    }

    let project_path = base_path.join(project_name);
    if project_path.exists() {
        let mut entries = project_path
            .read_dir()
            .map_err(|error| format!("Unable to inspect existing directory: {error}"))?;
        if entries.next().is_some() {
            return Err("Project directory already exists and is not empty".into());
        }
        fs::remove_dir(&project_path)
            .map_err(|error| format!("Unable to clear existing empty directory: {error}"))?;
    }

    let destination = project_path.clone();
    spawn_blocking(move || {
        emw::init::run_init(target, components, stm32_firmware, destination)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Failed to run init task: {error}"))??;

    Ok(CreateProjectResponse {
        path: project_path
            .canonicalize()
            .unwrap_or(project_path)
            .to_string_lossy()
            .to_string()
    })
}

fn parse_init_target(raw: &str) -> Result<emw::Target, String> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "esp32s3" | "esp32-s3" | "esp32_s3" => Ok(emw::Target::Esp32s3),
        "stm32f042" | "stm32-f042" | "stm32_f042" => Ok(emw::Target::Stm32f042),
        _ => Err("Unknown target (expected esp32s3 or stm32f042)".into()),
    }
}

fn parse_init_components(raw: &[String]) -> Result<Vec<emw::Component>, String> {
    let mut out = Vec::with_capacity(raw.len());
    for item in raw {
        let component = match item.trim().to_ascii_lowercase().as_str() {
            "ble" => emw::Component::Ble,
            "command_registry" | "command-registry" | "commandregistry" => emw::Component::CommandRegistry,
            "ota" => emw::Component::Ota,
            "gpio" => emw::Component::Gpio,
            "sampler" => emw::Component::Sampler,
            "cc1101" => emw::Component::Cc1101,
            "rfm69" => emw::Component::Rfm69,
            "mfrc522" => emw::Component::Mfrc522,
            _ => return Err(format!("Unknown component: {item}")),
        };
        if !out.contains(&component) {
            out.push(component);
        }
    }
    Ok(out)
}

fn parse_init_stm32_firmware(raw: Option<&str>) -> Result<Option<emw::Stm32Firmware>, String> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let value = raw.trim();
    if value.is_empty() {
        return Ok(None);
    }
    match value.to_ascii_lowercase().as_str() {
        "gpio" => Ok(Some(emw::Stm32Firmware::Gpio)),
        "ir" => Ok(Some(emw::Stm32Firmware::Ir)),
        "ism" => Ok(Some(emw::Stm32Firmware::Ism)),
        "rfid" => Ok(Some(emw::Stm32Firmware::Rfid)),
        _ => Err("Unknown STM32 firmware (expected gpio/ir/ism/rfid)".into()),
    }
}

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
struct DaemonState {
    socket: PathBuf,
}

impl DaemonState {
    fn new() -> Result<Self, String> {
        Ok(Self {
            socket: daemon_client::default_socket_path()?,
        })
    }

    fn ensure_running(&self) -> Result<(), String> {
        daemon_client::ensure_daemon_running(&self.socket)
    }

    async fn rpc(&self, method: &str, params: serde_json::Value, timeout: Duration) -> Result<serde_json::Value, String> {
        self.ensure_running()?;
        daemon_client::rpc(
            &self.socket,
            RpcRequest {
                id: 1,
                method: method.to_string(),
                params,
            },
            timeout,
        )
        .await
    }
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
async fn buffer_clear(state: State<'_, DaemonState>) -> Result<(), String> {
    state
        .rpc("buffer_clear", serde_json::json!({}), Duration::from_secs(3))
        .await?;
    Ok(())
}

#[tauri::command]
async fn buffer_get_counter(state: State<'_, DaemonState>) -> Result<u64, String> {
    let value = state
        .rpc("buffer_get_rx_counter", serde_json::json!({}), Duration::from_secs(3))
        .await?;
    Ok(value.get("rx_counter").and_then(|v| v.as_u64()).unwrap_or(0))
}

#[tauri::command]
async fn buffer_set_counter(state: State<'_, DaemonState>, value: u64) -> Result<(), String> {
    state
        .rpc(
            "buffer_set_rx_counter",
            serde_json::json!({ "value": value }),
            Duration::from_secs(3),
        )
        .await?;
    Ok(())
}

	#[tauri::command]
	async fn buffer_get_packet_count(state: State<'_, DaemonState>) -> Result<u64, String> {
	    let value = state
            .rpc("buffer_get_packet_count", serde_json::json!({}), Duration::from_secs(3))
            .await?;
        Ok(value.get("packet_count").and_then(|v| v.as_u64()).unwrap_or(0))
	}

	#[tauri::command]
	async fn buffer_get_len_bytes(state: State<'_, DaemonState>) -> Result<usize, String> {
	    let value = state
            .rpc("buffer_get_len_bytes", serde_json::json!({}), Duration::from_secs(3))
            .await?;
        Ok(value.get("len_bytes").and_then(|v| v.as_u64()).unwrap_or(0) as usize)
	}

#[tauri::command]
async fn buffer_read_packets_since(
    state: State<'_, DaemonState>,
    packet_index: u64,
    max_packets: usize,
) -> Result<ReadPacketsResponse, String> {
    let value = state
        .rpc(
            "buffer_read_packets_since",
            serde_json::json!({ "packet_index": packet_index, "max_packets": max_packets }),
            Duration::from_secs(3),
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
async fn buffer_next_packet(state: State<'_, DaemonState>) -> Result<Option<BufferPacket>, String> {
    let value = state
        .rpc("buffer_next_packet", serde_json::json!({}), Duration::from_secs(3))
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
    state: State<'_, DaemonState>,
    packet_index: u64,
    max_packets: usize,
) -> Result<ReadPacketsResponse, String> {
    let value = state
        .rpc(
            "buffer_read_tx_since",
            serde_json::json!({ "packet_index": packet_index, "max_packets": max_packets }),
            Duration::from_secs(3),
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
async fn buffer_get_bytes(state: State<'_, DaemonState>) -> Result<Vec<u8>, String> {
    let value = state
        .rpc("buffer_get_bytes", serde_json::json!({}), Duration::from_secs(3))
        .await?;
    let data_b64 = value.get("data_b64").and_then(|v| v.as_str()).unwrap_or("");
    decode_b64(data_b64)
}

#[tauri::command]
async fn buffer_set_bytes(state: State<'_, DaemonState>, data: Vec<u8>) -> Result<usize, String> {
    let value = state
        .rpc(
            "buffer_set_bytes",
            serde_json::json!({ "data_b64": encode_b64(&data) }),
            Duration::from_secs(3),
        )
        .await?;
    Ok(value.get("len_bytes").and_then(|v| v.as_u64()).unwrap_or(0) as usize)
}

#[tauri::command]
async fn buffer_set_invert_rx(state: State<'_, DaemonState>, enabled: bool) -> Result<(), String> {
    state
        .rpc(
            "buffer_set_invert_rx",
            serde_json::json!({ "enabled": enabled }),
            Duration::from_secs(3),
        )
        .await?;
    Ok(())
}

#[tauri::command]
async fn buffer_compress_viewport(
    state: State<'_, DaemonState>,
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
            Duration::from_secs(3),
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
    state: State<'_, DaemonState>,
    path: String,
) -> Result<(), String> {
    let path = expand_path(&path);
    let value = state
        .rpc("buffer_get_bytes", serde_json::json!({}), Duration::from_secs(3))
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
    state: State<'_, DaemonState>,
) -> Result<String, String> {
    let value = state
        .rpc("buffer_build_signed_raw_timings", serde_json::json!({}), Duration::from_secs(3))
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

// BLE Commands
#[tauri::command]
async fn ble_initialize(state: State<'_, DaemonState>) -> Result<(), String> {
    state.ensure_running()?;
    Ok(())
}

#[tauri::command]
async fn ble_start_scan(state: State<'_, DaemonState>) -> Result<(), String> {
    // In the daemon world "scan" is request-based; mimic prior UX by connecting.
    let _ = state
        .rpc(
            "connect",
            serde_json::json!({ "address": null, "name": "EMWaver" }),
            Duration::from_secs(15),
        )
        .await?;
    Ok(())
}

#[tauri::command]
async fn ble_stop_scan(_: State<'_, DaemonState>) -> Result<(), String> {
    // No-op: daemon does not keep a long-running scan loop.
    Ok(())
}

#[tauri::command]
async fn ble_disconnect(state: State<'_, DaemonState>) -> Result<(), String> {
    state
        .rpc("disconnect", serde_json::json!({}), Duration::from_secs(5))
        .await?;
    Ok(())
}

#[tauri::command]
async fn ble_send_packet(state: State<'_, DaemonState>, data: Vec<u8>) -> Result<(), String> {
    state
        .rpc(
            "write",
            serde_json::json!({ "bytes_b64": encode_b64(&data) }),
            Duration::from_secs(5),
        )
        .await?;
    Ok(())
}

#[tauri::command]
async fn ble_send_command(
    state: State<'_, DaemonState>,
    data: Vec<u8>,
    timeout_ms: u64,
    packets: u32,
) -> Result<Vec<u8>, String> {
    let value = state
        .rpc(
            "send_packet_command",
            serde_json::json!({
                "bytes_b64": encode_b64(&data),
                "timeout_ms": timeout_ms,
                "packets": packets
            }),
            Duration::from_millis(timeout_ms.saturating_add(5_000).max(1)),
        )
        .await?;
    let bytes_b64 = value.get("bytes_b64").and_then(|v| v.as_str()).unwrap_or("");
    decode_b64(bytes_b64)
}

#[tauri::command]
async fn ble_get_status(state: State<'_, DaemonState>) -> Result<BLEStatus, String> {
    let value = state
        .rpc("list_connected", serde_json::json!({}), Duration::from_secs(3))
        .await?;
    let devices = value.get("devices").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    for dev in devices {
        let transport = dev.get("transport").and_then(|v| v.as_str()).unwrap_or("");
        if transport == "ble" {
            return Ok(BLEStatus {
                connected: true,
                scanning: false,
                device_name: dev.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                device_address: dev
                    .get("address")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
            });
        }
    }
    Ok(BLEStatus {
        connected: false,
        scanning: false,
        device_name: None,
        device_address: None,
    })
}

#[tauri::command]
async fn ble_transmit_buffer(state: State<'_, DaemonState>, data: Vec<u8>) -> Result<(), String> {
    if data.is_empty() {
        return Err("Buffer is empty".to_string());
    }

    let path = spawn_blocking(move || {
        let mut file = tempfile::NamedTempFile::new()
            .map_err(|e| format!("Failed to create temp file: {e}"))?;
        file.write_all(&data)
            .map_err(|e| format!("Failed to write temp file: {e}"))?;
        let (_file, path) = file.keep().map_err(|e| format!("Failed to persist temp file: {e}"))?;
        Ok::<PathBuf, String>(path)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))??;

    let result = state
        .rpc(
            "transmit_buffer_file",
            serde_json::json!({ "path": path }),
            Duration::from_secs(120),
        )
        .await;

    // Best-effort cleanup.
    let _ = spawn_blocking(move || {
        let _ = std::fs::remove_file(&path);
    })
    .await;

    result?;
    Ok(())
}

// USB Commands
#[tauri::command]
async fn usb_list_ports() -> Result<Vec<String>, String> {
    let daemon = DaemonState::new()?;
    let value = daemon
        .rpc("usb_list_ports", serde_json::json!({}), Duration::from_secs(5))
        .await?;
    Ok(value
        .get("ports")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect::<Vec<String>>())
        .unwrap_or_default())
}

#[tauri::command]
async fn usb_connect(state: State<'_, DaemonState>, port_name: String) -> Result<(), String> {
    let _ = state
        .rpc(
            "usb_connect",
            serde_json::json!({ "port_name": port_name }),
            Duration::from_secs(10),
        )
        .await?;
    Ok(())
}

#[tauri::command]
async fn usb_disconnect(state: State<'_, DaemonState>) -> Result<(), String> {
    state
        .rpc("usb_disconnect", serde_json::json!({}), Duration::from_secs(5))
        .await?;
    Ok(())
}

#[tauri::command]
async fn usb_send_packet(state: State<'_, DaemonState>, data: Vec<u8>) -> Result<(), String> {
    // Transport is selected by the daemon's active connection.
    ble_send_packet(state, data).await
}

#[tauri::command]
async fn usb_send_command(
    state: State<'_, DaemonState>,
    data: Vec<u8>,
    timeout_ms: u64,
    packets: u32,
) -> Result<Vec<u8>, String> {
    ble_send_command(state, data, timeout_ms, packets).await
}

#[tauri::command]
async fn usb_transmit_buffer(state: State<'_, DaemonState>, data: Vec<u8>) -> Result<(), String> {
    ble_transmit_buffer(state, data).await
}

#[tauri::command]
async fn usb_get_status(state: State<'_, DaemonState>) -> Result<USBStatus, String> {
    let value = state
        .rpc("usb_status", serde_json::json!({}), Duration::from_secs(3))
        .await?;
    Ok(USBStatus {
        connected: value.get("connected").and_then(|v| v.as_bool()).unwrap_or(false),
        device_path: value
            .get("device_path")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    })
}

// MIDI Commands
#[tauri::command]
async fn midi_list_ports() -> Result<Vec<String>, String> {
    let daemon = DaemonState::new()?;
    let value = daemon
        .rpc("midi_list_ports", serde_json::json!({}), Duration::from_secs(5))
        .await?;
    Ok(value
        .get("ports")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect::<Vec<String>>())
        .unwrap_or_default())
}

#[tauri::command]
async fn midi_connect(state: State<'_, DaemonState>, port_name: String) -> Result<(), String> {
    let _ = state
        .rpc(
            "midi_connect",
            serde_json::json!({ "port_name": port_name }),
            Duration::from_secs(10),
        )
        .await?;
    Ok(())
}

#[tauri::command]
async fn midi_disconnect(state: State<'_, DaemonState>) -> Result<(), String> {
    state
        .rpc("midi_disconnect", serde_json::json!({}), Duration::from_secs(5))
        .await?;
    Ok(())
}

#[tauri::command]
async fn midi_get_status(state: State<'_, DaemonState>) -> Result<MidiStatus, String> {
    let value = state
        .rpc("midi_status", serde_json::json!({}), Duration::from_secs(3))
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

#[derive(Debug, Clone, serde::Serialize)]
struct OtaProgressEvent {
    message: String,
    sent_bytes: u64,
    total_bytes: u64,
    timestamp_ms: u64,
}

fn emit_ota_progress(app: &tauri::AppHandle, message: impl Into<String>, sent_bytes: u64, total_bytes: u64) {
    let _ = app.emit(
        "ota-progress",
        OtaProgressEvent {
            message: message.into(),
            sent_bytes,
            total_bytes,
            timestamp_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        },
    );
}

fn parse_ota_status(notification: &[u8]) -> Option<(u8, u32, u32, u8)> {
    if notification.len() != 14 {
        return None;
    }
    if &notification[0..3] != b"OTA" {
        return None;
    }
    if notification[3] != 1 {
        return None;
    }
    let status = notification[4];
    let received = u32::from_le_bytes([notification[5], notification[6], notification[7], notification[8]]);
    let total = u32::from_le_bytes([notification[9], notification[10], notification[11], notification[12]]);
    let err = notification[13];
    Some((status, received, total, err))
}

fn bytes_to_hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

#[derive(Clone)]
struct DaemonEvents {
    ota_status_tx: tokio::sync::broadcast::Sender<Vec<u8>>,
}

async fn wait_for_ota_success(
    app: &tauri::AppHandle,
    events: &DaemonEvents,
    total_bytes: u64,
    timeout_seconds: u64,
) -> Result<(), String> {
    let mut rx = events.ota_status_tx.subscribe();
    let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(timeout_seconds);

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err("Timed out waiting for OTA completion status".to_string());
        }

        let next = tokio::time::timeout(remaining, rx.recv())
            .await
            .map_err(|_| "Timed out waiting for OTA completion status".to_string())?;

        let bytes = match next {
            Ok(v) => v,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                return Err("Lost connection to daemon OTA status stream".to_string());
            }
        };

        if let Some((code, received, total, err)) = parse_ota_status(&bytes) {
            let msg = format!(
                "Device OTA status: code=0x{code:02x} received={received} total={total} err=0x{err:02x}"
            );
            emit_ota_progress(app, msg, total_bytes, total_bytes);
            match code {
                0x13 => return Ok(()), // SUCCESS
                0x14 | 0x15 => return Err(format!("OTA failed (code=0x{code:02x}, err=0x{err:02x})")),
                _ => {}
            }
        }
    }
}

async fn wifi_http_post_firmware(
    app: &tauri::AppHandle,
    bytes: &[u8],
    sha256_hex: &str,
    total_bytes: u64,
) -> Result<(), String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    let addr = "192.168.4.1:80";
    let mut stream = tokio::time::timeout(tokio::time::Duration::from_secs(10), TcpStream::connect(addr))
        .await
        .map_err(|_| "Timed out connecting to 192.168.4.1 (are you connected to EMWaver-OTA?)".to_string())?
        .map_err(|e| format!("Failed to connect to {addr}: {e}"))?;

    let request = format!(
        "POST /ota HTTP/1.1\r\nHost: 192.168.4.1\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nX-Emwaver-Sha256: {}\r\nConnection: close\r\n\r\n",
        bytes.len(),
        sha256_hex
    );
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|e| format!("Failed to write HTTP request headers: {e}"))?;

    let mut sent = 0usize;
    let mut last_progress_emit = 0usize;
    for chunk in bytes.chunks(16 * 1024) {
        stream
            .write_all(chunk)
            .await
            .map_err(|e| format!("Failed to write firmware body: {e}"))?;
        sent += chunk.len();
        if sent - last_progress_emit >= 64 * 1024 || sent == bytes.len() {
            last_progress_emit = sent;
            emit_ota_progress(app, "Uploading over WiFi...", sent as u64, total_bytes);
        }
    }

    stream.shutdown().await.ok();

    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .await
        .map_err(|e| format!("Failed to read OTA HTTP response: {e}"))?;

    let response_str = String::from_utf8_lossy(&response);
    let status_line = response_str.lines().next().unwrap_or_default();
    if !(status_line.starts_with("HTTP/1.1 200") || status_line.starts_with("HTTP/1.0 200")) {
        return Err(format!("OTA HTTP upload failed: {status_line}"));
    }
    Ok(())
}

async fn ble_ota_flash_bytes(
    app: &tauri::AppHandle,
    daemon: &DaemonState,
    events: &DaemonEvents,
    bytes: &[u8],
    label: &str,
) -> Result<(), String> {
    let connected = daemon
        .rpc("connection_status", serde_json::json!({}), Duration::from_secs(3))
        .await?
        .get("connected")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !connected {
        return Err("Not connected to a device".to_string());
    }

    if bytes.is_empty() {
        return Err("Firmware is empty".to_string());
    }

    let total_bytes = bytes.len() as u64;
    emit_ota_progress(app, format!("{label} size: {} bytes", total_bytes), 0, total_bytes);

    use sha2::{Digest as _, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let sha = hasher.finalize();

    let mut start = Vec::with_capacity(1 + 4 + 32);
    start.push(0x01);
    start.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    start.extend_from_slice(&sha[..]);

    emit_ota_progress(app, "Starting OTA session...", 0, total_bytes);
    daemon
        .rpc(
            "ble_ota_write_control",
            serde_json::json!({ "bytes_b64": encode_b64(&start) }),
            Duration::from_secs(5),
        )
        .await?;

    let chunk_size = 200usize;
    let mut sent = 0usize;
    let mut last_progress_emit = 0usize;

    for chunk in bytes.chunks(chunk_size) {
        daemon
            .rpc(
                "ble_ota_write_data",
                serde_json::json!({ "bytes_b64": encode_b64(chunk) }),
                Duration::from_secs(5),
            )
            .await?;
        sent += chunk.len();

        if sent - last_progress_emit >= 16 * 1024 || sent == bytes.len() {
            last_progress_emit = sent;
            emit_ota_progress(app, "Uploading...", sent as u64, total_bytes);
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(3)).await;
    }

    emit_ota_progress(app, "Finalizing...", total_bytes, total_bytes);
    daemon
        .rpc(
            "ble_ota_write_control",
            serde_json::json!({ "bytes_b64": encode_b64(&[0x03]) }),
            Duration::from_secs(5),
        )
        .await?;

    wait_for_ota_success(app, events, total_bytes, 30).await
}

#[tauri::command]
async fn ble_ota_flash_file(
    app: tauri::AppHandle,
    daemon: State<'_, DaemonState>,
    events: State<'_, DaemonEvents>,
    path: String,
) -> Result<(), String> {
    let firmware_path = expand_path(&path);
    let bytes = std::fs::read(&firmware_path)
        .map_err(|e| format!("Failed to read firmware file {}: {}", firmware_path.display(), e))?;
    ble_ota_flash_bytes(&app, &daemon, &events, &bytes, "Firmware").await
}

#[tauri::command]
async fn ble_ota_flash_stock(
    app: tauri::AppHandle,
    daemon: State<'_, DaemonState>,
    events: State<'_, DaemonEvents>,
) -> Result<(), String> {
    ble_ota_flash_bytes(&app, &daemon, &events, ESP32_STOCK_FIRMWARE_BIN, "Stock firmware").await
}

#[tauri::command]
async fn ota_wifi_start(daemon: State<'_, DaemonState>) -> Result<(), String> {
    daemon
        .rpc(
            "ble_ota_write_control",
            serde_json::json!({ "bytes_b64": encode_b64(&[0x10]) }),
            Duration::from_secs(5),
        )
        .await?;
    Ok(())
}

#[tauri::command]
async fn ota_wifi_stop(daemon: State<'_, DaemonState>) -> Result<(), String> {
    daemon
        .rpc(
            "ble_ota_write_control",
            serde_json::json!({ "bytes_b64": encode_b64(&[0x11]) }),
            Duration::from_secs(5),
        )
        .await?;
    Ok(())
}

async fn wifi_ota_flash_bytes(
    app: &tauri::AppHandle,
    daemon: &DaemonState,
    events: &DaemonEvents,
    bytes: &[u8],
    label: &str,
) -> Result<(), String> {
    let connected = daemon
        .rpc("connection_status", serde_json::json!({}), Duration::from_secs(3))
        .await?
        .get("connected")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !connected {
        return Err("Not connected to a device".to_string());
    }

    if bytes.is_empty() {
        return Err("Firmware is empty".to_string());
    }

    let total_bytes = bytes.len() as u64;
    emit_ota_progress(app, format!("{label} size: {} bytes", total_bytes), 0, total_bytes);
    emit_ota_progress(
        app,
        "WiFi OTA: connect to Wi-Fi 'EMWaver-OTA' then upload to http://192.168.4.1/ota",
        0,
        total_bytes,
    );

    use sha2::{Digest as _, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let sha = hasher.finalize();
    let sha_hex = bytes_to_hex_lower(&sha[..]);

    emit_ota_progress(app, "Uploading over WiFi...", 0, total_bytes);
    wifi_http_post_firmware(app, bytes, &sha_hex, total_bytes).await?;

    emit_ota_progress(app, "Waiting for device to finalize...", total_bytes, total_bytes);
    wait_for_ota_success(app, events, total_bytes, 30).await
}

#[tauri::command]
async fn ota_wifi_flash_file(
    app: tauri::AppHandle,
    daemon: State<'_, DaemonState>,
    events: State<'_, DaemonEvents>,
    path: String,
) -> Result<(), String> {
    let firmware_path = expand_path(&path);
    let bytes = std::fs::read(&firmware_path)
        .map_err(|e| format!("Failed to read firmware file {}: {}", firmware_path.display(), e))?;
    wifi_ota_flash_bytes(&app, &daemon, &events, &bytes, "Firmware").await
}

#[tauri::command]
async fn ota_wifi_flash_stock(
    app: tauri::AppHandle,
    daemon: State<'_, DaemonState>,
    events: State<'_, DaemonEvents>,
) -> Result<(), String> {
    wifi_ota_flash_bytes(&app, &daemon, &events, ESP32_STOCK_FIRMWARE_BIN, "Stock firmware").await
}
#[tauri::command]
async fn dfu_flash_embedded(app: tauri::AppHandle, firmware: String) -> Result<(), String> {
    let selection = EmbeddedFirmware::from_str(&firmware)
        .ok_or_else(|| format!("Unknown embedded firmware: {firmware}"))?;
    let bytes = selection.bytes();
    let app_handle = app.clone();

    spawn_blocking(move || {
        emit_dfu_progress(&app_handle, "Opening DFU device...");
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

#[tauri::command]
async fn dfu_flash_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let firmware_path = expand_path(&path);
    let app_handle = app.clone();

    spawn_blocking(move || {
        emit_dfu_progress(&app_handle, format!("Reading firmware file: {}", firmware_path.display()));
        let bytes = fs::read(&firmware_path)
            .map_err(|e| format!("Failed to read firmware file {}: {e}", firmware_path.display()))?;
        emit_dfu_progress(&app_handle, format!("Firmware size: {} bytes", bytes.len()));

        emit_dfu_progress(&app_handle, "Opening DFU device...");
        let (mut device, _discovery) = DfuDevice::open_with_options(
            DEFAULT_USB_VENDOR_ID,
            DEFAULT_USB_PRODUCT_ID,
            DfuOpenOptions {
                alt_setting: None,
                verbose: false,
            },
        )?;
        device.flash(&bytes, 0x0800_0000, |msg| emit_dfu_progress(&app_handle, msg))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;
    use tauri_plugin_window_state::{AppHandleExt, StateFlags, WindowExt};

    let window_state_flags = StateFlags::SIZE | StateFlags::POSITION;

    // Desktop and CLI must agree on the daemon socket path; otherwise we can spawn multiple daemons
    // that contend for the same USB/BLE transport and cause "Resource busy" errors.
    let daemon_state = DaemonState::new().expect("failed to determine emwaver daemon socket path");
    let (ota_status_tx, _) = tokio::sync::broadcast::channel::<Vec<u8>>(256);
    let daemon_events = DaemonEvents { ota_status_tx };
    let daemon_state_for_setup = daemon_state.clone();
    let daemon_events_for_setup = daemon_events.clone();

    tauri::Builder::default()
        .setup(move |app| {
            let handle = app.handle();

            // Background daemon event pump (OTA status notifications).
            #[cfg(unix)]
            {
                use tokio::net::UnixStream;
                let daemon = daemon_state_for_setup.clone();
                let events = daemon_events_for_setup.clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        if daemon.ensure_running().is_err() {
                            tokio::time::sleep(Duration::from_millis(500)).await;
                            continue;
                        }

                        let stream = UnixStream::connect(&daemon.socket).await;
                        let Ok(stream) = stream else {
                            tokio::time::sleep(Duration::from_millis(500)).await;
                            continue;
                        };

                        let mut reader = BufReader::new(stream);
                        let mut line = String::new();
                        loop {
                            line.clear();
                            let n = match reader.read_line(&mut line).await {
                                Ok(v) => v,
                                Err(_) => break,
                            };
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
                            let Some(event) = value.get("event").and_then(|v| v.as_str()) else {
                                continue;
                            };
                            if event != "ota_status" {
                                continue;
                            }
                            let bytes_b64 = value
                                .get("data")
                                .and_then(|d| d.get("bytes_b64"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            if let Ok(bytes) = decode_b64(bytes_b64) {
                                let _ = events.ota_status_tx.send(bytes);
                            }
                        }
                    }
                });
            }

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
            let ide_open_folder_item = MenuItem::with_id(
                app,
                "menu-ide-open-folder",
                "Open Folder…",
                true,
                Some("CmdOrCtrl+Shift+O"),
            )?;
            let ide_save_file_item = MenuItem::with_id(
                app,
                "menu-ide-save-file",
                "Save",
                true,
                Some("CmdOrCtrl+S"),
            )?;
            let firmware_build_item = MenuItem::with_id(
                app,
                "menu-ide-firmware-build",
                "Build Firmware",
                true,
                Some("CmdOrCtrl+Shift+B"),
            )?;
            let firmware_flash_item = MenuItem::with_id(
                app,
                "menu-ide-firmware-flash",
                "Flash Firmware",
                true,
                Some("CmdOrCtrl+Shift+F"),
            )?;
            let firmware_build_flash_item = MenuItem::with_id(
                app,
                "menu-ide-firmware-build-flash",
                "Build && Flash Firmware",
                true,
                Some("CmdOrCtrl+Shift+R"),
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
            let show_wavelets_item = MenuItem::with_id(
                app,
                "menu-show-wavelets",
                "Show Wavelets",
                true,
                None::<&str>,
            )?;
            let show_ism_item = MenuItem::with_id(
                app,
                "menu-show-ism",
                "Show ISM (RFM69)",
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
            let show_ide_item = MenuItem::with_id(
                app,
                "menu-show-ide",
                "Show IDE",
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
            // Wavelets menu items removed - no longer needed

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
                                submenu.append(&ide_open_folder_item)?;
                                submenu.append(&ide_save_file_item)?;
                                submenu.append(&close_item)?;
                                close_item_added = true;
                            } else if label == "View" {
                                submenu.append(&increase_layout_item)?;
                                submenu.append(&decrease_layout_item)?;
                                submenu.append(&reset_layout_item)?;
                                submenu.append(&toggle_explorer_item)?;
                                submenu.append(&show_explorer_item)?;
                                submenu.append(&show_wavelets_item)?;
                                submenu.append(&show_ism_item)?;
                                submenu.append(&show_sampler_item)?;
                                submenu.append(&show_emwaver_item)?;
                                submenu.append(&show_ide_item)?;
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
                file_menu.append(&ide_open_folder_item)?;
                file_menu.append(&ide_save_file_item)?;
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
                view_menu.append(&show_wavelets_item)?;
                view_menu.append(&show_ism_item)?;
                view_menu.append(&show_sampler_item)?;
                view_menu.append(&show_emwaver_item)?;
                view_menu.append(&show_ide_item)?;
                menu.append(&view_menu)?;
            }

            let projects_menu = Submenu::new(app, "Projects", true)?;
            projects_menu.append(&new_item)?;
            projects_menu.append(&open_item)?;
            menu.append(&projects_menu)?;

            let firmware_menu = Submenu::new(app, "Firmware", true)?;
            firmware_menu.append(&firmware_build_item)?;
            firmware_menu.append(&firmware_flash_item)?;
            firmware_menu.append(&firmware_build_flash_item)?;
            menu.append(&firmware_menu)?;

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
                "menu-show-wavelets" => {
                    let _ = app.emit(MENU_SHOW_WAVELETS_EVENT, ());
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
                "menu-show-ide" => {
                    let _ = app.emit(MENU_SHOW_IDE_EVENT, ());
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
                "menu-ide-open-folder" => {
                    let _ = app.emit(MENU_IDE_OPEN_FOLDER_EVENT, ());
                }
                "menu-ide-save-file" => {
                    let _ = app.emit(MENU_IDE_SAVE_FILE_EVENT, ());
                }
                "menu-ide-firmware-build" => {
                    let _ = app.emit(MENU_IDE_FIRMWARE_BUILD_EVENT, ());
                }
                "menu-ide-firmware-flash" => {
                    let _ = app.emit(MENU_IDE_FIRMWARE_FLASH_EVENT, ());
                }
                "menu-ide-firmware-build-flash" => {
                    let _ = app.emit(MENU_IDE_FIRMWARE_BUILD_FLASH_EVENT, ());
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
        .manage(daemon_state)
        .manage(daemon_events)
        .manage(Arc::new(PtyManager::new()))
			        .invoke_handler(tauri::generate_handler![
            create_project,
            read_directory,
            read_directory_children,
            read_file,
            file_modified_ms,
            read_binary_file,
            write_file,
            write_binary_file,
            ensure_dir,
            buffer_clear,
            buffer_get_counter,
            buffer_set_counter,
            buffer_get_packet_count,
            buffer_get_len_bytes,
            buffer_read_packets_since,
            buffer_next_packet,
            buffer_read_tx_since,
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
            ble_initialize,
            ble_start_scan,
            ble_stop_scan,
            ble_disconnect,
            ble_send_packet,
            ble_send_command,
            ble_get_status,
            ble_transmit_buffer,
            ble_ota_flash_file,
            ble_ota_flash_stock,
            ota_wifi_start,
            ota_wifi_stop,
            ota_wifi_flash_file,
            ota_wifi_flash_stock,
	            usb_list_ports,
	            usb_connect,
	            usb_disconnect,
			            usb_send_packet,
	                    usb_send_command,
	                    usb_transmit_buffer,
	                    usb_get_status,
                        midi_list_ports,
                        midi_connect,
                        midi_disconnect,
                        midi_get_status,
			            dfu_is_connected,
		            dfu_flash_embedded,
		            dfu_flash_file,
                firmware_build,
                firmware_flash,
                git_status,
                git_diff_contents,
                git_stage,
                git_stage_all,
                git_unstage,
                git_unstage_all,
                git_discard,
                git_commit,
                git_push
	        ])
	        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
