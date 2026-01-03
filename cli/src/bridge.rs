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

use std::collections::HashMap;
use std::io::{Read as _, Write as _};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use base64::Engine as _;
use btleplug::api::{
    Central, CentralEvent, CentralState, Characteristic, Manager as _, Peripheral as _, ScanFilter,
    WriteType,
};
use btleplug::platform::{Adapter, Manager, Peripheral};
use serde::{Deserialize, Serialize};
use serde_json::json;
#[cfg(any(test, not(unix)))]
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
#[cfg(any(test, not(unix)))]
use tokio::runtime::Runtime;
use tokio::sync::{broadcast, mpsc};
use tokio::sync::{Mutex as AsyncMutex, Notify};
use tokio::time::timeout;
use tokio_stream::StreamExt;
use uuid::Uuid;

use serialport::{DataBits, FlowControl, Parity, SerialPort, SerialPortInfo, SerialPortType, StopBits};

use emwaver_buffer_core::buffer::{self, Buffer};
use emwaver_buffer_core::packet::{make_packet64, PACKET_SIZE};
use emwaver_buffer_core::sampler;
use emwaver_buffer_core::status;
use emwaver_buffer_core::tx;

const SERVICE_UUID: Uuid = uuid::uuid!("45c7158e-0c3b-4e90-a847-452a15b14191");
const CMD_CHAR_UUID: Uuid = uuid::uuid!("46c7158e-0c3b-4e90-a847-452a15b14191");
const NOTIF_CHAR_UUID: Uuid = uuid::uuid!("47c7158e-0c3b-4e90-a847-452a15b14191");

// Desktop-only OTA service (today used by the Tauri app); keep here so the daemon
// can be the single BLE owner across processes.
const OTA_SERVICE_UUID: Uuid = uuid::uuid!("45c7158e-0c3b-4e90-a847-452a15b14192");
const OTA_CTRL_CHAR_UUID: Uuid = uuid::uuid!("45c7158e-0c3b-4e90-a847-452a15b14193");
const OTA_DATA_CHAR_UUID: Uuid = uuid::uuid!("45c7158e-0c3b-4e90-a847-452a15b14194");
const OTA_STATUS_CHAR_UUID: Uuid = uuid::uuid!("45c7158e-0c3b-4e90-a847-452a15b14195");

const DEFAULT_SCAN_TIMEOUT_MS: u64 = 6_000;
const DEFAULT_DEVICE_NAME: &str = "EMWaver";

const EMWAVER_STM32_VID: u16 = 0x0483;
const EMWAVER_STM32_USB_PID_FS: u16 = 0x5740;

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct BridgeRequest {
    pub(crate) id: u64,
    pub(crate) method: String,
    #[serde(default)]
    pub(crate) params: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub(crate) struct BridgeResponse {
    pub(crate) id: u64,
    pub(crate) ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<BridgeError>,
}

#[derive(Debug, Serialize)]
pub(crate) struct BridgeError {
    pub(crate) message: String,
}

#[derive(Debug, Serialize)]
struct BridgeEvent<'a> {
    event: &'a str,
    data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
struct DeviceInfo {
    transport: &'static str,
    name: Option<String>,
    address: String,
}

#[derive(Debug, Clone)]
struct BleChars {
    cmd: Characteristic,
    notif: Characteristic,
    ota_ctrl: Option<Characteristic>,
    ota_data: Option<Characteristic>,
    ota_status: Option<Characteristic>,
}

#[derive(Debug, Clone, Serialize)]
struct UsbStatus {
    connected: bool,
    device_path: Option<String>,
}

#[derive(Clone)]
struct UsbConnection {
    port: Arc<AsyncMutex<Option<Box<dyn SerialPort + Send>>>>,
    running: Arc<AsyncMutex<bool>>,
    status: Arc<AsyncMutex<UsbStatus>>,
}

pub(crate) struct BridgeState {
    adapter: Option<Adapter>,
    peripherals: Arc<AsyncMutex<HashMap<String, Peripheral>>>,
    connected: Arc<AsyncMutex<Option<Peripheral>>>,
    chars: Arc<AsyncMutex<Option<BleChars>>>,
    usb: Arc<AsyncMutex<Option<UsbConnection>>>,
    buffer: Arc<Mutex<Buffer>>,
    rx_notify: Arc<Notify>,
    in_flight: Arc<AsyncMutex<()>>,
    pub(crate) event_tx: broadcast::Sender<Vec<u8>>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(any(test, not(unix)))]
pub fn run_bridge() -> Result<()> {
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async { run_bridge_async().await })
}

#[cfg(any(test, not(unix)))]
async fn run_bridge_async() -> Result<()> {
    let state = create_bridge_state().await?;

    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Vec<u8>>();

    let writer_task = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(line) = out_rx.recv().await {
            if stdout.write_all(&line).await.is_err() {
                break;
            }
            let _ = stdout.flush().await;
        }
    });

    let mut events_rx = state.event_tx.subscribe();
    let out_tx_events = out_tx.clone();
    let events_task = tokio::spawn(async move {
        loop {
            match events_rx.recv().await {
                Ok(line) => {
                    let _ = out_tx_events.send(line);
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // Important: do not print anything non-JSON to stdout (extension parses this stream).
    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin);
    let mut line = String::new();

    loop {
        line.clear();
        let bytes_read = reader
            .read_line(&mut line)
            .await
            .context("failed to read stdin")?;
        if bytes_read == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let req: BridgeRequest = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => {
                // Protocol violation: ignore.
                continue;
            }
        };

        let id = req.id;
        let response = match dispatch_request(Arc::clone(&state), req).await {
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

        send_json_line(&out_tx, &response)?;
    }

    // Drain pending stdout lines before exiting so callers don't lose responses.
    drop(state);
    let _ = timeout(Duration::from_secs(1), writer_task).await;
    let _ = timeout(Duration::from_secs(1), events_task).await;

    Ok(())
}

pub(crate) fn send_json_line(tx: &mpsc::UnboundedSender<Vec<u8>>, value: &impl Serialize) -> Result<()> {
    let mut buf = serde_json::to_vec(value).context("failed to encode json")?;
    buf.push(b'\n');
    tx.send(buf).map_err(|_| anyhow!("output channel closed"))?;
    Ok(())
}

fn emit_event(state: &BridgeState, event: &str, data: serde_json::Value) -> Result<()> {
    let mut buf = serde_json::to_vec(&BridgeEvent { event, data }).context("failed to encode json")?;
    buf.push(b'\n');
    let _ = state.event_tx.send(buf);
    Ok(())
}

pub(crate) async fn dispatch_request(
    state: Arc<BridgeState>,
    req: BridgeRequest,
) -> Result<serde_json::Value> {
    let method = req.method.as_str();

    match method {
        "hello" => Ok(json!({
            "protocol": 1,
            "cli": env!("CARGO_PKG_VERSION"),
            "transports": ["ble", "usb"],
            "features": {
                "buffer": true,
                "send_command": true,
                "write": true,
                "transmit_buffer": true,
                "ota": true
            }
        })),
        "list_devices" => {
            let timeout_ms = req
                .params
                .get("timeout_ms")
                .and_then(|v| v.as_u64())
                .unwrap_or(DEFAULT_SCAN_TIMEOUT_MS);
            let all = req
                .params
                .get("all")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let name = if all {
                None
            } else {
                req.params
                    .get("name")
                    .and_then(|v| v.as_str())
                    .map(|v| v.to_string())
                    .or_else(|| Some(DEFAULT_DEVICE_NAME.to_string()))
            };
            let devices = ble_list_devices(&state, timeout_ms, name).await?;
            Ok(json!({ "devices": devices }))
        }
        "connect" => {
            let address = req
                .params
                .get("address")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string());
            let name = req
                .params
                .get("name")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string());
            let info = ble_connect(&state, address, name).await?;
            Ok(json!({ "device": info }))
        }
        "list_connected" => {
            if let Some(peripheral) = state.connected.lock().await.as_ref() {
                return Ok(json!({
                    "devices": [{
                        "transport": "ble",
                        "name": DEFAULT_DEVICE_NAME,
                        "address": peripheral.address().to_string()
                    }]
                }));
            }
            if let Some(conn) = state.usb.lock().await.as_ref() {
                let status = conn.status.lock().await.clone();
                if status.connected {
                    if let Some(path) = status.device_path {
                        return Ok(json!({
                            "devices": [{
                                "transport": "usb",
                                "name": "USB Device",
                                "address": path
                            }]
                        }));
                    }
                }
            }
            Ok(json!({ "devices": [] }))
        }
        "disconnect" => {
            ble_disconnect(&state).await?;
            usb_disconnect(&state).await?;
            Ok(json!({}))
        }
        "send_command" => {
            let text = req
                .params
                .get("text")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("missing params.text"))?
                .to_string();
            let timeout_ms = req
                .params
                .get("timeout_ms")
                .and_then(|v| v.as_u64())
                .unwrap_or(1500);
            let packets = req
                .params
                .get("packets")
                .and_then(|v| v.as_u64())
                .unwrap_or(1) as u32;
            let bytes = send_command_text(&state, &text, timeout_ms, packets).await?;
            let bytes_b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
            Ok(json!({ "bytes_b64": bytes_b64 }))
        }
        "send_packet_command" => {
            let bytes_b64 = req
                .params
                .get("bytes_b64")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("missing params.bytes_b64"))?;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(bytes_b64.as_bytes())
                .map_err(|e| anyhow!("invalid base64: {e}"))?;
            let timeout_ms = req
                .params
                .get("timeout_ms")
                .and_then(|v| v.as_u64())
                .unwrap_or(1500);
            let packets = req
                .params
                .get("packets")
                .and_then(|v| v.as_u64())
                .unwrap_or(1) as u32;
            let resp = send_packet_command(&state, bytes, timeout_ms, packets).await?;
            let bytes_b64 = base64::engine::general_purpose::STANDARD.encode(resp);
            Ok(json!({ "bytes_b64": bytes_b64 }))
        }
        "write" => {
            let bytes_b64 = req
                .params
                .get("bytes_b64")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("missing params.bytes_b64"))?;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(bytes_b64.as_bytes())
                .map_err(|e| anyhow!("invalid base64: {e}"))?;
            write_active(&state, bytes).await?;
            Ok(json!({}))
        }
        "transmit_buffer" => {
            let bytes_b64 = req
                .params
                .get("bytes_b64")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("missing params.bytes_b64"))?;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(bytes_b64.as_bytes())
                .map_err(|e| anyhow!("invalid base64: {e}"))?;
            transmit_buffer_active(&state, bytes).await?;
            Ok(json!({}))
        }
        "transmit_buffer_file" => {
            let path = req
                .params
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("missing params.path"))?;
            let bytes = std::fs::read(path).with_context(|| format!("failed to read file: {path}"))?;
            transmit_buffer_active(&state, bytes).await?;
            Ok(json!({}))
        }
        "connection_status" => {
            let connected = if state.connected.lock().await.is_some() {
                true
            } else if let Some(conn) = state.usb.lock().await.as_ref() {
                conn.status.lock().await.connected
            } else {
                false
            };
            Ok(json!({ "connected": connected }))
        }
        "usb_list_ports" => {
            let ports = usb_list_ports_blocking()?;
            Ok(json!({ "ports": ports }))
        }
        "usb_connect" => {
            let port_name = req
                .params
                .get("port_name")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string());
            let info = usb_connect(&state, port_name).await?;
            Ok(json!({ "device": info }))
        }
        "usb_disconnect" => {
            usb_disconnect(&state).await?;
            Ok(json!({}))
        }
        "usb_status" => {
            if let Some(conn) = state.usb.lock().await.as_ref() {
                let status = conn.status.lock().await.clone();
                Ok(json!(status))
            } else {
                Ok(json!(UsbStatus { connected: false, device_path: None }))
            }
        }
        "ble_ota_write_control" => {
            let bytes_b64 = req
                .params
                .get("bytes_b64")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("missing params.bytes_b64"))?;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(bytes_b64.as_bytes())
                .map_err(|e| anyhow!("invalid base64: {e}"))?;
            ble_ota_write_control(&state, bytes).await?;
            Ok(json!({}))
        }
        "ble_ota_write_data" => {
            let bytes_b64 = req
                .params
                .get("bytes_b64")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("missing params.bytes_b64"))?;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(bytes_b64.as_bytes())
                .map_err(|e| anyhow!("invalid base64: {e}"))?;
            ble_ota_write_data(&state, bytes).await?;
            Ok(json!({}))
        }
        "buffer_clear" => {
            if let Ok(mut guard) = state.buffer.lock() {
                buffer::clear(&mut *guard);
            }
            Ok(json!({}))
        }
        "buffer_read_packets_since" | "buffer_read_rx_since" => {
            let index = req
                .params
                .get("packet_index")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let max_packets = req
                .params
                .get("max_packets")
                .and_then(|v| v.as_u64())
                .unwrap_or(256) as usize;
            let snapshot = state
                .buffer
                .lock()
                .map_err(|_| anyhow!("buffer lock poisoned"))?;
            let packets = buffer::read_rx_since(&*snapshot, index, max_packets);
            let bytes_b64 = base64::engine::general_purpose::STANDARD.encode(packets.data);
            Ok(json!({
                "data_b64": bytes_b64,
                "ts_ms": packets.ts_ms,
                "next_packet_index": packets.next_packet_index,
                "available_packets": packets.available_packets
            }))
        }
        "buffer_read_tx_since" => {
            let index = req
                .params
                .get("packet_index")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let max_packets = req
                .params
                .get("max_packets")
                .and_then(|v| v.as_u64())
                .unwrap_or(256) as usize;
            let snapshot = state
                .buffer
                .lock()
                .map_err(|_| anyhow!("buffer lock poisoned"))?;
            let packets = buffer::read_tx_since(&*snapshot, index, max_packets);
            let bytes_b64 = base64::engine::general_purpose::STANDARD.encode(packets.data);
            Ok(json!({
                "data_b64": bytes_b64,
                "ts_ms": packets.ts_ms,
                "next_packet_index": packets.next_packet_index,
                "available_packets": packets.available_packets
            }))
        }
        "buffer_next_packet" => {
            let packet = {
                let mut snapshot = state
                    .buffer
                    .lock()
                    .map_err(|_| anyhow!("buffer lock poisoned"))?;
                buffer::next_rx_packet(&mut *snapshot)
            };
            if let Some(pkt) = packet {
                let bytes_b64 = base64::engine::general_purpose::STANDARD.encode(pkt.data);
                Ok(json!({ "packet": { "data_b64": bytes_b64, "ts_ms": pkt.ts_ms } }))
            } else {
                Ok(json!({ "packet": null }))
            }
        }
        "buffer_get_packet_count" => {
            let snapshot = state
                .buffer
                .lock()
                .map_err(|_| anyhow!("buffer lock poisoned"))?;
            Ok(json!({ "packet_count": buffer::rx_packet_count(&*snapshot) }))
        }
        "buffer_get_len_bytes" => {
            let snapshot = state
                .buffer
                .lock()
                .map_err(|_| anyhow!("buffer lock poisoned"))?;
            Ok(json!({ "len_bytes": buffer::rx_len_bytes(&*snapshot) }))
        }
        "buffer_get_bytes" => {
            let snapshot = state
                .buffer
                .lock()
                .map_err(|_| anyhow!("buffer lock poisoned"))?;
            let bytes_b64 =
                base64::engine::general_purpose::STANDARD.encode(buffer::rx_snapshot(&*snapshot));
            Ok(json!({ "data_b64": bytes_b64 }))
        }
        "buffer_set_bytes" => {
            let bytes_b64 = req
                .params
                .get("data_b64")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("missing params.data_b64"))?;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(bytes_b64.as_bytes())
                .map_err(|e| anyhow!("invalid base64: {e}"))?;
            let len_bytes = {
                let mut snapshot = state
                    .buffer
                    .lock()
                    .map_err(|_| anyhow!("buffer lock poisoned"))?;
                buffer::rx_set_bytes(&mut *snapshot, bytes);
                buffer::rx_len_bytes(&*snapshot)
            };
            Ok(json!({ "len_bytes": len_bytes }))
        }
        "buffer_set_bytes_file" => {
            let path = req
                .params
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("missing params.path"))?;
            let bytes = std::fs::read(path).with_context(|| format!("failed to read file: {path}"))?;
            let len_bytes = {
                let mut snapshot = state
                    .buffer
                    .lock()
                    .map_err(|_| anyhow!("buffer lock poisoned"))?;
                buffer::rx_set_bytes(&mut *snapshot, bytes);
                buffer::rx_len_bytes(&*snapshot)
            };
            Ok(json!({ "len_bytes": len_bytes }))
        }
        "buffer_save_bytes_file" => {
            let path = req
                .params
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("missing params.path"))?;
            let snapshot = state
                .buffer
                .lock()
                .map_err(|_| anyhow!("buffer lock poisoned"))?;
            let bytes = buffer::rx_snapshot(&*snapshot);
            std::fs::write(path, bytes).with_context(|| format!("failed to write file: {path}"))?;
            Ok(json!({}))
        }
        "buffer_transmit" => {
            let bytes = {
                let snapshot = state
                    .buffer
                    .lock()
                    .map_err(|_| anyhow!("buffer lock poisoned"))?;
                buffer::rx_snapshot(&*snapshot).to_vec()
            };
            transmit_buffer_active(&state, bytes).await?;
            Ok(json!({}))
        }
        "buffer_set_invert_rx" => {
            let enabled = req
                .params
                .get("enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if let Ok(mut guard) = state.buffer.lock() {
                buffer::set_invert_rx(&mut *guard, enabled);
            }
            Ok(json!({}))
        }
        "buffer_compress_viewport" => {
            let range_start = req
                .params
                .get("range_start")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as usize;
            let range_end = req
                .params
                .get("range_end")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as usize;
            let number_bins = req
                .params
                .get("number_bins")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as usize;

            let snapshot = state
                .buffer
                .lock()
                .map_err(|_| anyhow!("buffer lock poisoned"))?;
            let bytes = buffer::rx_snapshot(&*snapshot);
            let buffer_len_bytes = bytes.len();
            let (time_values, data_values) = sampler::compress_bits(&bytes, range_start, range_end, number_bins);
            Ok(json!({
                "buffer_len_bytes": buffer_len_bytes,
                "time_values": time_values,
                "data_values": data_values
            }))
        }
        "buffer_build_signed_raw_timings" => {
            let snapshot = state
                .buffer
                .lock()
                .map_err(|_| anyhow!("buffer lock poisoned"))?;
            let bytes = buffer::rx_snapshot(&*snapshot);
            Ok(json!({ "timings": sampler::build_signed_raw_timings(&bytes, 10) }))
        }
        "buffer_get_rx_counter" => {
            let snapshot = state
                .buffer
                .lock()
                .map_err(|_| anyhow!("buffer lock poisoned"))?;
            Ok(json!({ "rx_counter": snapshot.rx_counter }))
        }
        "buffer_set_rx_counter" => {
            let value = req
                .params
                .get("value")
                .and_then(|v| v.as_u64())
                .ok_or_else(|| anyhow!("missing params.value"))?;
            if let Ok(mut guard) = state.buffer.lock() {
                let packets = buffer::rx_packet_count(&*guard);
                guard.rx_counter = value.min(packets);
            }
            Ok(json!({}))
        }
        _ => Err(anyhow!("unknown method: {method}")),
    }
}

async fn write_active(state: &BridgeState, bytes: Vec<u8>) -> Result<()> {
    if state.connected.lock().await.is_some() {
        return ble_write(state, bytes).await;
    }
    if let Some(conn) = state.usb.lock().await.as_ref() {
        if conn.status.lock().await.connected {
            return usb_write_packet(state, bytes).await;
        }
    }
    bail!("not connected");
}

async fn send_packet_command(
    state: &BridgeState,
    bytes: Vec<u8>,
    timeout_ms: u64,
    packets: u32,
) -> Result<Vec<u8>> {
    let _in_flight = state.in_flight.lock().await;

    // Use the daemon's broadcasted `rx_bytes` events to collect responses.
    //
    // Rationale: the daemon's RX buffer has a single global cursor (`rx_counter`)
    // which can be consumed by other concurrent clients (desktop app, shell,
    // sampler). Using `rx_bytes` events gives each request its own copy of the
    // response packets without fighting over a shared cursor.
    let mut events = state.event_tx.subscribe();

    write_active(state, bytes).await?;

    if packets == 0 {
        return Ok(Vec::new());
    }

    let want_packets = packets as usize;
    let want_bytes = want_packets.saturating_mul(PACKET_SIZE);
    let mut out = Vec::with_capacity(want_bytes);

    let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms.max(1));
    while out.len() < want_bytes {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            bail!("timeout waiting for response");
        }

        let msg = match timeout(remaining, events.recv()).await {
            Ok(Ok(m)) => m,
            Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(_))) => continue,
            Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) => {
                bail!("daemon events channel closed")
            }
            Err(_) => bail!("timeout waiting for response"),
        };

        let trimmed = std::str::from_utf8(&msg).unwrap_or("").trim();
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
        if event != "rx_bytes" {
            continue;
        }

        let Some(bytes_b64) = value
            .get("data")
            .and_then(|v| v.get("bytes_b64"))
            .and_then(|v| v.as_str())
        else {
            continue;
        };
        let Ok(pkt) = base64::engine::general_purpose::STANDARD.decode(bytes_b64.as_bytes()) else {
            continue;
        };
        if pkt.is_empty() {
            continue;
        }
        if pkt.len() == PACKET_SIZE {
            if let Some(bs) = status::parse_bs(&pkt) {
                let _ = emit_event(state, "bs", json!({ "value": bs }));
            }
        }
        out.extend_from_slice(&pkt);
    }

    Ok(out)
}

async fn send_command_text(
    state: &BridgeState,
    text: &str,
    timeout_ms: u64,
    packets: u32,
) -> Result<Vec<u8>> {
    let payload = parse_command(text)?;
    send_packet_command(state, payload.to_vec(), timeout_ms, packets).await
}

async fn transmit_buffer_active(state: &BridgeState, data: Vec<u8>) -> Result<()> {
    let _in_flight = state.in_flight.lock().await;
    if state.connected.lock().await.is_some() {
        return ble_transmit_buffer(state, data).await;
    }
    if let Some(conn) = state.usb.lock().await.as_ref() {
        if conn.status.lock().await.connected {
            return usb_transmit_buffer(state, data).await;
        }
    }
    bail!("not connected");
}

async fn ble_ota_write_control(state: &BridgeState, data: Vec<u8>) -> Result<()> {
    if data.is_empty() {
        bail!("control payload is empty");
    }

    let (peripheral, ctrl_char) = {
        let guard = state.connected.lock().await;
        let Some(peripheral) = guard.as_ref() else {
            bail!("not connected");
        };
        let chars = state
            .chars
            .lock()
            .await
            .clone()
            .ok_or_else(|| anyhow!("characteristics not ready"))?;
        let ctrl = chars
            .ota_ctrl
            .ok_or_else(|| anyhow!("ota control characteristic not found"))?;
        (peripheral.clone(), ctrl)
    };

    peripheral
        .write(&ctrl_char, &data, WriteType::WithResponse)
        .await
        .context("failed to write ota control")?;
    Ok(())
}

async fn ble_ota_write_data(state: &BridgeState, data: Vec<u8>) -> Result<()> {
    if data.is_empty() {
        return Ok(());
    }

    let (peripheral, data_char) = {
        let guard = state.connected.lock().await;
        let Some(peripheral) = guard.as_ref() else {
            bail!("not connected");
        };
        let chars = state
            .chars
            .lock()
            .await
            .clone()
            .ok_or_else(|| anyhow!("characteristics not ready"))?;
        let ch = chars
            .ota_data
            .ok_or_else(|| anyhow!("ota data characteristic not found"))?;
        (peripheral.clone(), ch)
    };

    peripheral
        .write(&data_char, &data, WriteType::WithoutResponse)
        .await
        .context("failed to write ota data")?;
    Ok(())
}

pub(crate) async fn create_bridge_state() -> Result<Arc<BridgeState>> {
    let adapter = match Manager::new().await {
        Ok(manager) => match manager.adapters().await {
            Ok(adapters) => {
                let adapter = adapters.into_iter().next();
                if let Some(adapter) = adapter.as_ref() {
                    match adapter.adapter_state().await {
                        Ok(CentralState::PoweredOff) => {
                            eprintln!("warning: bluetooth appears to be off");
                        }
                        Ok(CentralState::Unknown) => {
                            eprintln!("warning: bluetooth adapter state unknown; discovery may fail");
                        }
                        Ok(CentralState::PoweredOn) => {}
                        Err(err) => {
                            eprintln!("warning: failed to query bluetooth power state: {err:#}");
                        }
                    }
                } else {
                    eprintln!("warning: no BLE adapters found (BLE transport unavailable)");
                }
                adapter
            }
            Err(err) => {
                eprintln!("warning: failed to list BLE adapters: {err:#}");
                None
            }
        },
        Err(err) => {
            eprintln!("warning: failed to initialize BLE manager: {err:#}");
            None
        }
    };

    let (event_tx, _) = broadcast::channel::<Vec<u8>>(1024);

    Ok(Arc::new(BridgeState {
        adapter,
        peripherals: Arc::new(AsyncMutex::new(HashMap::new())),
        connected: Arc::new(AsyncMutex::new(None)),
        chars: Arc::new(AsyncMutex::new(None)),
        usb: Arc::new(AsyncMutex::new(None)),
        buffer: Arc::new(Mutex::new(Buffer::default())),
        rx_notify: Arc::new(Notify::new()),
        in_flight: Arc::new(AsyncMutex::new(())),
        event_tx,
    }))
}

async fn ble_write(state: &BridgeState, bytes: Vec<u8>) -> Result<()> {
    let (peripheral, cmd_char) = {
        let guard = state.connected.lock().await;
        let Some(peripheral) = guard.as_ref() else {
            bail!("not connected");
        };
        let chars = state
            .chars
            .lock()
            .await
            .clone()
            .ok_or_else(|| anyhow!("characteristics not ready"))?;
        (peripheral.clone(), chars.cmd)
    };

    let packet = make_packet64(&bytes).map_err(|e| anyhow!(e))?;
    peripheral
        .write(&cmd_char, &packet, WriteType::WithoutResponse)
        .await
        .context("failed to write")?;
    if let Ok(mut guard) = state.buffer.lock() {
        buffer::append_tx_packet(&mut *guard, &packet, now_ms());
    }
    Ok(())
}

fn is_emwaver_usb_port(port: &SerialPortInfo) -> bool {
    let SerialPortType::UsbPort(usb) = &port.port_type else {
        return false;
    };

    if usb.vid == EMWAVER_STM32_VID && usb.pid == EMWAVER_STM32_USB_PID_FS {
        return true;
    }

    if usb
        .manufacturer
        .as_deref()
        .is_some_and(|m| m.eq_ignore_ascii_case("EMWaver"))
    {
        return true;
    }

    usb.product.as_deref().is_some_and(|p| {
        matches!(
            p,
            "ISM Waver" | "EMWaver" | "GPIO Waver" | "IR Waver"
        )
    })
}

fn normalize_port_name_for_platform(port_name: &str) -> String {
    let trimmed = port_name.trim();
    #[cfg(target_os = "macos")]
    {
        if let Some(rest) = trimmed.strip_prefix("/dev/tty.") {
            let candidate = format!("/dev/cu.{rest}");
            if std::path::Path::new(&candidate).exists() {
                return candidate;
            }
        }
    }
    trimmed.to_string()
}

fn usb_list_ports_blocking() -> Result<Vec<String>> {
    let ports = serialport::available_ports().context("failed to list serial ports")?;
    let mut names: Vec<String> = ports
        .into_iter()
        .filter(|p| matches!(p.port_type, SerialPortType::UsbPort(_)))
        .filter(is_emwaver_usb_port)
        .map(|p| p.port_name)
        .collect();

    #[cfg(target_os = "macos")]
    {
        use std::collections::HashSet;
        let set: HashSet<String> = names.iter().cloned().collect();
        names.retain(|n| {
            if let Some(rest) = n.strip_prefix("/dev/tty.") {
                !set.contains(&format!("/dev/cu.{rest}"))
            } else {
                true
            }
        });
        names.retain(|n| !n.contains("Bluetooth-Incoming-Port"));
    }

    names.sort_by_key(|n| {
        if n.contains("usbmodem") {
            (0, n.clone())
        } else if n.contains("usbserial") {
            (1, n.clone())
        } else {
            (2, n.clone())
        }
    });

    Ok(names)
}

fn usb_open_port_blocking(port_name: &str) -> Result<Box<dyn SerialPort + Send>> {
    let mut port = serialport::new(port_name, 115_200)
        .data_bits(DataBits::Eight)
        .parity(Parity::None)
        .stop_bits(StopBits::One)
        .flow_control(FlowControl::None)
        .timeout(Duration::from_millis(100))
        .open()
        .with_context(|| format!("failed to open serial port: {port_name}"))?;

    let _ = port.write_data_terminal_ready(true);
    let _ = port.write_request_to_send(true);
    Ok(port)
}

async fn usb_disconnect(state: &BridgeState) -> Result<()> {
    let existing = { state.usb.lock().await.take() };
    if let Some(conn) = existing {
        *conn.running.lock().await = false;
        *conn.port.lock().await = None;
        {
            let mut s = conn.status.lock().await;
            s.connected = false;
            s.device_path = None;
        }
        let _ = emit_event(state, "disconnected", json!({ "transport": "usb" }));
    }
    Ok(())
}

fn spawn_usb_reader(
    state_events: broadcast::Sender<Vec<u8>>,
    buffer: Arc<Mutex<Buffer>>,
    rx_notify: Arc<Notify>,
    running: Arc<AsyncMutex<bool>>,
    port_state: Arc<AsyncMutex<Option<Box<dyn SerialPort + Send>>>>,
    status: Arc<AsyncMutex<UsbStatus>>,
) -> Result<()> {
    let mut read_port = {
        let mut guard = port_state.blocking_lock();
        let Some(port) = guard.as_mut() else {
            bail!("port not initialized");
        };
        port.try_clone().context("failed to clone serial port")?
    };

    std::thread::spawn(move || {
        let mut buf = [0u8; 1024];
        let mut pending: Vec<u8> = Vec::new();

        let mark_disconnected = || {
            *running.blocking_lock() = false;
            *port_state.blocking_lock() = None;
            let mut s = status.blocking_lock();
            s.connected = false;
            s.device_path = None;

            let payload = BridgeEvent {
                event: "disconnected",
                data: json!({ "transport": "usb" }),
            };
            if let Ok(mut out) = serde_json::to_vec(&payload) {
                out.push(b'\n');
                let _ = state_events.send(out);
            }
        };

        loop {
            if !*running.blocking_lock() {
                break;
            }

            match read_port.read(&mut buf) {
                Ok(n) => {
                    if n == 0 {
                        continue;
                    }
                    pending.extend_from_slice(&buf[..n]);
                    while pending.len() >= PACKET_SIZE {
                        let chunk: Vec<u8> = pending.drain(0..PACKET_SIZE).collect();
                        let ts_ms = now_ms();
                        if let Ok(mut guard) = buffer.lock() {
                            buffer::append_rx_bytes(&mut *guard, &chunk, ts_ms);
                        }
                        rx_notify.notify_waiters();

                        let bytes_b64 = base64::engine::general_purpose::STANDARD.encode(&chunk);
                        let payload = BridgeEvent {
                            event: "rx_bytes",
                            data: json!({ "bytes_b64": bytes_b64, "ts_ms": ts_ms }),
                        };
                        if let Ok(mut out) = serde_json::to_vec(&payload) {
                            out.push(b'\n');
                            let _ = state_events.send(out);
                        }
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {}
                Err(_) => {
                    mark_disconnected();
                    break;
                }
            }
        }
    });

    Ok(())
}

async fn usb_connect(state: &BridgeState, port_name: Option<String>) -> Result<DeviceInfo> {
    // Prefer a single active transport: drop BLE if it's active.
    let _ = ble_disconnect(state).await;

    let chosen = match port_name {
        Some(p) => normalize_port_name_for_platform(&p),
        None => {
            let ports = usb_list_ports_blocking()?;
            let Some(first) = ports.into_iter().next() else {
                bail!("no USB EMWaver devices found");
            };
            first
        }
    };

    let port = usb_open_port_blocking(&chosen)?;
    let conn = UsbConnection {
        port: Arc::new(AsyncMutex::new(Some(port))),
        running: Arc::new(AsyncMutex::new(true)),
        status: Arc::new(AsyncMutex::new(UsbStatus {
            connected: true,
            device_path: Some(chosen.clone()),
        })),
    };

    spawn_usb_reader(
        state.event_tx.clone(),
        Arc::clone(&state.buffer),
        Arc::clone(&state.rx_notify),
        Arc::clone(&conn.running),
        Arc::clone(&conn.port),
        Arc::clone(&conn.status),
    )?;

    *state.usb.lock().await = Some(conn);
    let _ = emit_event(
        state,
        "connected",
        json!({ "transport": "usb", "address": chosen, "name": "USB Device" }),
    );

    Ok(DeviceInfo {
        transport: "usb",
        name: Some("USB Device".to_string()),
        address: chosen,
    })
}

async fn usb_write_packet(state: &BridgeState, bytes: Vec<u8>) -> Result<()> {
    let conn = {
        let guard = state.usb.lock().await;
        guard.clone().ok_or_else(|| anyhow!("not connected"))?
    };

    let packet = make_packet64(&bytes).map_err(|e| anyhow!(e))?;

    let mut port_guard = conn.port.lock().await;
    let Some(port) = port_guard.as_mut() else {
        bail!("not connected");
    };
    port.write_all(&packet).context("failed to write serial")?;
    port.flush().ok();

    if let Ok(mut guard) = state.buffer.lock() {
        buffer::append_tx_packet(&mut *guard, &packet, now_ms());
    }
    Ok(())
}

async fn ble_list_devices(
    state: &BridgeState,
    timeout_ms: u64,
    name: Option<String>,
) -> Result<Vec<DeviceInfo>> {
    let adapter = state
        .adapter
        .as_ref()
        .ok_or_else(|| anyhow!("BLE transport unavailable"))?;

    {
        let mut guard = state.peripherals.lock().await;
        guard.clear();
    }

    let mut events = adapter
        .events()
        .await
        .context("failed to subscribe to adapter events")?;

    adapter
        // Avoid service UUID scan filters for portability (CoreBluetooth can miss results).
        .start_scan(ScanFilter::default())
        .await
        .context("failed to start scan")?;

    let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms.max(1));
    while tokio::time::Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        let maybe_event = timeout(remaining.min(Duration::from_millis(500)), events.next()).await;
        let Ok(Some(event)) = maybe_event else { continue };

        let id = match event {
            CentralEvent::DeviceDiscovered(id)
            | CentralEvent::DeviceUpdated(id)
            | CentralEvent::DeviceConnected(id)
            | CentralEvent::ManufacturerDataAdvertisement { id, .. } => id,
            _ => continue,
        };

        let peripheral = adapter
            .peripheral(&id)
            .await
            .context("failed to access peripheral")?;
        let props = peripheral
            .properties()
            .await
            .context("failed to read peripheral properties")?;
        let Some(props) = props else { continue };
        let local_name = props.local_name.clone();
        if let Some(ref want) = name {
            let Some(ref got) = local_name else { continue };
            if got != want {
                continue;
            }
        }

        let address = peripheral.address().to_string();
        state
            .peripherals
            .lock()
            .await
            .insert(address.clone(), peripheral);
    }

    adapter.stop_scan().await.ok();

    let snapshot: Vec<(String, Peripheral)> = {
        let guard = state.peripherals.lock().await;
        guard.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    };
    let mut devices = Vec::with_capacity(snapshot.len());
    for (address, peripheral) in snapshot.iter() {
        let name = peripheral
            .properties()
            .await
            .ok()
            .flatten()
            .and_then(|p| p.local_name);
        devices.push(DeviceInfo {
            transport: "ble",
            name,
            address: address.clone(),
        });
    }
    Ok(devices)
}

async fn ble_connect(
    state: &BridgeState,
    address: Option<String>,
    name: Option<String>,
) -> Result<DeviceInfo> {
    // Prefer a single active transport: drop any existing connection.
    let _ = ble_disconnect(state).await;
    let _ = usb_disconnect(state).await;

    let want_name = name.unwrap_or_else(|| "EMWaver".to_string());
    let peripheral = if let Some(address) = address {
        if let Some(p) = state.peripherals.lock().await.get(&address).cloned() {
            p
        } else {
            // Scan to resolve the peripheral by address.
            let _ = ble_list_devices(state, DEFAULT_SCAN_TIMEOUT_MS, None).await?;
            state
                .peripherals
                .lock()
                .await
                .get(&address)
                .cloned()
                .ok_or_else(|| anyhow!("device not found: {address}"))?
        }
    } else {
        // Scan and pick by name.
        let devices = ble_list_devices(state, DEFAULT_SCAN_TIMEOUT_MS, Some(want_name.clone())).await?;
        let Some(first) = devices.first() else {
            bail!("no matching devices found");
        };
        state
            .peripherals
            .lock()
            .await
            .get(&first.address)
            .cloned()
            .ok_or_else(|| anyhow!("device disappeared"))?
    };

    if !peripheral.is_connected().await? {
        peripheral.connect().await?;
    }
    peripheral.discover_services().await?;

    let chars = locate_characteristics(&peripheral)?;

    peripheral.subscribe(&chars.notif).await?;
    if let Some(ota_status) = chars.ota_status.as_ref() {
        let _ = peripheral.subscribe(ota_status).await;
    }

    {
        let mut guard = state.connected.lock().await;
        *guard = Some(peripheral.clone());
    }
    {
        let mut guard = state.chars.lock().await;
        *guard = Some(chars.clone());
    }

    spawn_notifications(
        Arc::new(peripheral.clone()),
        Arc::clone(&state.buffer),
        Arc::clone(&state.rx_notify),
        state.event_tx.clone(),
    );
    let _ = emit_event(
        state,
        "connected",
        json!({
            "transport": "ble",
            "address": peripheral.address().to_string(),
            "name": want_name,
        }),
    );

    Ok(DeviceInfo {
        transport: "ble",
        name: Some(want_name),
        address: peripheral.address().to_string(),
    })
}

async fn ble_disconnect(state: &BridgeState) -> Result<()> {
    let peripheral = {
        let mut guard = state.connected.lock().await;
        guard.take()
    };
    *state.chars.lock().await = None;

    if let Some(peripheral) = peripheral {
        let _ = timeout(Duration::from_secs(2), peripheral.disconnect()).await;
        let _ = emit_event(state, "disconnected", json!({ "transport": "ble" }));
    }
    Ok(())
}

async fn ble_send_command(
    state: &BridgeState,
    text: &str,
    timeout_ms: u64,
    packets: u32,
) -> Result<Vec<u8>> {
    let _in_flight = state.in_flight.lock().await;
    let (peripheral, cmd_char) = {
        let guard = state.connected.lock().await;
        let Some(peripheral) = guard.as_ref() else {
            bail!("not connected");
        };
        let chars = state
            .chars
            .lock()
            .await
            .clone()
            .ok_or_else(|| anyhow!("characteristics not ready"))?;
        (peripheral.clone(), chars.cmd)
    };

    // Drop stale RX so the next N packets correspond to this request.
    if let Ok(mut guard) = state.buffer.lock() {
        let count = buffer::rx_packet_count(&*guard);
        guard.rx_counter = count;
    }

    let payload = parse_command(text)?;
    peripheral
        .write(&cmd_char, &payload, WriteType::WithoutResponse)
        .await
        .context("failed to write command")?;
    if let Ok(mut guard) = state.buffer.lock() {
        buffer::append_tx_packet(&mut *guard, &payload, now_ms());
    }

    let want_packets = std::cmp::max(1, packets) as usize;
    let want_bytes = want_packets.saturating_mul(PACKET_SIZE);
    let mut out = Vec::with_capacity(want_bytes);

    let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms.max(1));
    while out.len() < want_bytes {
        let maybe_packet = (|| {
            let mut guard = state.buffer.lock().ok()?;
            buffer::next_rx_packet(&mut *guard)
        })();

        if let Some(pkt) = maybe_packet {
            if let Some(value) = status::parse_bs(&pkt.data) {
                let _ = emit_event(state, "bs", json!({ "value": value }));
            }
            out.extend_from_slice(&pkt.data);
            continue;
        }

        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            bail!("timeout waiting for response");
        }
        timeout(remaining.min(Duration::from_millis(200)), state.rx_notify.notified())
            .await
            .ok();
    }

    Ok(out)
}

async fn ble_transmit_buffer(state: &BridgeState, data: Vec<u8>) -> Result<()> {
    let (peripheral, cmd_char) = {
        let guard = state.connected.lock().await;
        let Some(peripheral) = guard.as_ref() else {
            bail!("not connected");
        };
        let chars = state
            .chars
            .lock()
            .await
            .clone()
            .ok_or_else(|| anyhow!("characteristics not ready"))?;
        (peripheral.clone(), chars.cmd)
    };

    if data.is_empty() {
        bail!("buffer is empty");
    }

    // Swap out the shared RX buffer while transmitting so BS flow-control packets
    // don't contaminate sampler data stored in the same buffer.
    let (saved_rx, saved_rx_ts, saved_counter) = {
        let mut guard = state
            .buffer
            .lock()
            .map_err(|_| anyhow!("buffer lock poisoned"))?;
        let saved_rx = std::mem::take(&mut guard.rx_bytes);
        let saved_rx_ts = std::mem::take(&mut guard.rx_ts_ms);
        let saved_counter = guard.rx_counter;
        guard.rx_counter = 0;
        (saved_rx, saved_rx_ts, saved_counter)
    };

    let result = async {
        let profile = tx::BleTxProfile::default();
        let mut current_packet_size = profile.max_packet_size;

        let total_bytes = data.len();
        let mut bytes_sent = 0usize;
        let mut last_status: Option<u16> = None;

        let drain_bs_status = || -> Option<u16> {
            let mut latest: Option<u16> = None;
            loop {
                let pkt = (|| {
                    let mut guard = state.buffer.lock().ok()?;
                    buffer::next_rx_packet(&mut *guard)
                })();
                let Some(pkt) = pkt else { break };
                if let Some(status) = status::parse_bs(&pkt.data) {
                    latest = Some(status);
                }
            }
            latest
        };

        while bytes_sent < total_bytes {
            if let Some(status) = drain_bs_status() {
                last_status = Some(status);
            }
            let effective_buffer_status = last_status
                .map(|v| v as i32)
                .unwrap_or(profile.target_buffer_level);

            let remaining = total_bytes - bytes_sent;
            let packet_size = std::cmp::min(current_packet_size, remaining);
            let end = bytes_sent + packet_size;
            let packet = &data[bytes_sent..end];

            peripheral
                .write(&cmd_char, packet, WriteType::WithoutResponse)
                .await
                .context("failed to write transmit chunk")?;

            current_packet_size = tx::ble_next_packet_size(
                profile,
                bytes_sent,
                effective_buffer_status,
                current_packet_size,
            )
            .clamp(profile.min_packet_size, profile.max_packet_size);

            tokio::time::sleep(tokio::time::Duration::from_millis(profile.fixed_delay_ms as u64)).await;
            bytes_sent += packet_size;
        }

        Ok::<(), anyhow::Error>(())
    }
    .await;

    // Restore sampler RX buffer (discarding BS packets accumulated during transmit).
    if let Ok(mut guard) = state.buffer.lock() {
        guard.rx_bytes = saved_rx;
        guard.rx_ts_ms = saved_rx_ts;
        guard.rx_counter = saved_counter;
    }

    result.map_err(|e| anyhow!(e))
}

async fn usb_transmit_buffer(state: &BridgeState, data: Vec<u8>) -> Result<()> {
    let conn = state
        .usb
        .lock()
        .await
        .clone()
        .ok_or_else(|| anyhow!("not connected"))?;

    if data.is_empty() {
        bail!("buffer is empty");
    }

    // Swap out the shared RX buffer while transmitting so response packets
    // don't contaminate sampler data stored in the same buffer.
    let (saved_rx, saved_rx_ts, saved_counter) = {
        let mut guard = state
            .buffer
            .lock()
            .map_err(|_| anyhow!("buffer lock poisoned"))?;
        let saved_rx = std::mem::take(&mut guard.rx_bytes);
        let saved_rx_ts = std::mem::take(&mut guard.rx_ts_ms);
        let saved_counter = guard.rx_counter;
        guard.rx_counter = 0;
        (saved_rx, saved_rx_ts, saved_counter)
    };

    let mut write_port = {
        let mut port_guard = conn.port.lock().await;
        let Some(p) = port_guard.as_mut() else {
            bail!("not connected");
        };
        p.try_clone().context("failed to clone serial port")?
    };

    let buffer_clone = Arc::clone(&state.buffer);
    let write_result = tokio::task::spawn_blocking(move || {
        let profile = tx::UsbTxProfile::default();
        let packet_size: usize = profile.packet_size;

        std::thread::sleep(Duration::from_millis(20));

        let mut last_status: u16 = 0;
        let start = std::time::Instant::now();
        let mut next_send_at_ns: i64 = 0;

        for chunk in data.chunks(packet_size) {
            if let Ok(mut guard) = buffer_clone.lock() {
                loop {
                    let pkt = buffer::next_rx_packet(&mut *guard);
                    let Some(pkt) = pkt else { break };
                    if let Some(status) = status::parse_bs(&pkt.data) {
                        last_status = status;
                    }
                }
            }

            write_port
                .write_all(chunk)
                .context("failed to write serial")?;

            if let Ok(mut guard) = buffer_clone.lock() {
                let mut packet = [0u8; PACKET_SIZE];
                packet[..chunk.len()].copy_from_slice(chunk);
                buffer::append_tx_packet(&mut *guard, &packet, now_ms());
            }

            next_send_at_ns = next_send_at_ns.saturating_add(profile.period_ns);
            next_send_at_ns = tx::usb_adjust_deadline_ns(profile, next_send_at_ns, last_status as i32);

            let now_ns = start.elapsed().as_nanos() as i64;
            let sleep_ns = next_send_at_ns.saturating_sub(now_ns);
            if sleep_ns > 0 {
                std::thread::sleep(Duration::from_nanos(sleep_ns as u64));
            }
        }

        write_port.flush().ok();
        Ok::<(), anyhow::Error>(())
    })
    .await
    .map_err(|e| anyhow!("task join failed: {e}"))?;

    // Restore sampler RX buffer (discarding packets accumulated during transmit).
    if let Ok(mut guard) = state.buffer.lock() {
        guard.rx_bytes = saved_rx;
        guard.rx_ts_ms = saved_rx_ts;
        guard.rx_counter = saved_counter;
    }

    write_result
}

fn spawn_notifications(
    peripheral: Arc<Peripheral>,
    buffer: Arc<Mutex<Buffer>>,
    rx_notify: Arc<Notify>,
    event_tx: broadcast::Sender<Vec<u8>>,
) {
    tokio::spawn(async move {
        let Ok(mut stream) = peripheral.notifications().await else {
            eprintln!("bridge: failed to listen for notifications");
            return;
        };

        while let Some(event) = stream.next().await {
            let ts_ms = now_ms();
            if event.uuid == NOTIF_CHAR_UUID {
                if let Ok(mut guard) = buffer.lock() {
                    buffer::append_rx_bytes(&mut *guard, &event.value, ts_ms);
                }
                rx_notify.notify_waiters();

                let bytes_b64 = base64::engine::general_purpose::STANDARD.encode(&event.value);
                let payload = BridgeEvent {
                    event: "rx_bytes",
                    data: json!({ "bytes_b64": bytes_b64, "ts_ms": ts_ms }),
                };
                if let Ok(mut buf) = serde_json::to_vec(&payload) {
                    buf.push(b'\n');
                    let _ = event_tx.send(buf);
                }
            } else if event.uuid == OTA_STATUS_CHAR_UUID {
                let bytes_b64 = base64::engine::general_purpose::STANDARD.encode(&event.value);
                let payload = BridgeEvent {
                    event: "ota_status",
                    data: json!({ "bytes_b64": bytes_b64, "ts_ms": ts_ms }),
                };
                if let Ok(mut buf) = serde_json::to_vec(&payload) {
                    buf.push(b'\n');
                    let _ = event_tx.send(buf);
                }
            }
        }
    });
}

fn locate_characteristics(peripheral: &Peripheral) -> Result<BleChars> {
    let mut cmd_char = None;
    let mut notif_char = None;
    let mut ota_ctrl = None;
    let mut ota_data = None;
    let mut ota_status = None;

    for service in peripheral.services() {
        if service.uuid == SERVICE_UUID {
            for characteristic in service.characteristics.iter() {
                if characteristic.uuid == CMD_CHAR_UUID {
                    cmd_char = Some(characteristic.clone());
                }
                if characteristic.uuid == NOTIF_CHAR_UUID {
                    notif_char = Some(characteristic.clone());
                }
            }
        } else if service.uuid == OTA_SERVICE_UUID {
            for characteristic in service.characteristics.iter() {
                if characteristic.uuid == OTA_CTRL_CHAR_UUID {
                    ota_ctrl = Some(characteristic.clone());
                }
                if characteristic.uuid == OTA_DATA_CHAR_UUID {
                    ota_data = Some(characteristic.clone());
                }
                if characteristic.uuid == OTA_STATUS_CHAR_UUID {
                    ota_status = Some(characteristic.clone());
                }
            }
        }
    }

    Ok(BleChars {
        cmd: cmd_char.ok_or_else(|| anyhow!("command characteristic not found"))?,
        notif: notif_char.ok_or_else(|| anyhow!("notification characteristic not found"))?,
        ota_ctrl,
        ota_data,
        ota_status,
    })
}

fn parse_command(input: &str) -> Result<[u8; PACKET_SIZE]> {
    let mut bytes = Vec::new();
    let mut idx = 0;
    let data = input.as_bytes();

    while idx < data.len() {
        if data[idx] == b'[' {
            let end = input[idx + 1..]
                .find(']')
                .map(|off| idx + 1 + off)
                .ok_or_else(|| anyhow!("missing closing ']'"))?;
            let content = input[idx + 1..end].trim();
            let value = parse_bracket_value(content)?;
            bytes.push(value);
            idx = end + 1;
        } else {
            bytes.push(data[idx]);
            idx += 1;
        }
    }

    make_packet64(&bytes).map_err(|e| anyhow!(e))
}

fn parse_bracket_value(content: &str) -> Result<u8> {
    if content.is_empty() {
        bail!("empty value inside brackets");
    }

    let value = if let Some(stripped) = content
        .strip_prefix("0x")
        .or_else(|| content.strip_prefix("0X"))
    {
        u8::from_str_radix(stripped, 16).context("invalid hex value")?
    } else {
        u8::from_str_radix(content, 10).context("invalid decimal value")?
    };

    Ok(value)
}
