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
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use base64::Engine as _;
use midir::{Ignore, MidiInput, MidiOutput};
use rusb::UsbContext;
use serde::{Deserialize, Serialize};
use serde_json::json;
#[cfg(any(test, not(unix)))]
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
#[cfg(any(test, not(unix)))]
use tokio::runtime::Runtime;
use tokio::sync::{broadcast, mpsc};
use tokio::sync::{Mutex as AsyncMutex, Notify};
use tokio::time::timeout;

use emwaver_buffer_core::buffer::{self, Buffer};
use emwaver_buffer_core::packet::{make_packet64, PACKET_SIZE};
use emwaver_buffer_core::sampler;
use emwaver_buffer_core::status;
use emwaver_buffer_core::tx;

use crate::midi_sysex;

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

const RX_QUEUE_CAPACITY: usize = 8192;

// From `stm/emwaver-firmware/USB_DEVICE/App/usbd_desc.c` (USBD_VID / USBD_PID_FS).
const EMWAVER_USB_MIDI_VID: u16 = 0x0483;
const EMWAVER_USB_MIDI_PID: u16 = 0x5740;

#[derive(Debug)]
struct RxQueuedPacket {
    pkt: [u8; PACKET_SIZE],
    ts_ms: u64,
    generation: u64,
}

#[derive(Debug, Clone, Serialize)]
struct DeviceInfo {
    transport: &'static str,
    name: Option<String>,
    address: String,
}

struct MidiSystem {
    in_: MidiInput,
    out: MidiOutput,
}

#[derive(Debug, Clone, Serialize)]
struct MidiStatus {
    connected: bool,
    device_name: Option<String>,
}

struct MidiConnection {
    out: Arc<Mutex<midir::MidiOutputConnection>>,
    _in: midir::MidiInputConnection<()>,
    status: Arc<AsyncMutex<MidiStatus>>,
}

pub(crate) struct BridgeState {
    midi: Arc<AsyncMutex<Option<MidiConnection>>>,
    midi_system: Arc<AsyncMutex<Option<MidiSystem>>>,
    buffer: Arc<Mutex<Buffer>>,
    rx_notify: Arc<Notify>,
    rx_queue_tx: mpsc::Sender<RxQueuedPacket>,
    rx_drop: Arc<AtomicBool>,
    rx_queue_dropped: Arc<AtomicU64>,
    rx_gen: Arc<AtomicU64>,
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
            "protocol": 2,
            "event_schema": 2,
            "cli": env!("CARGO_PKG_VERSION"),
            "transports": ["midi"],
            "features": {
                "buffer": true,
                "send_command": true,
                "write": true,
                "transmit_buffer": true,
                "ota": false
            }
        })),
        "connect" => {
            let port_name = req
                .params
                .get("port_name")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string());
            let info = midi_connect(&state, port_name).await?;
            Ok(json!({ "device": info }))
        }
        "list_connected" => {
            if let Some(conn) = state.midi.lock().await.as_ref() {
                let status = conn.status.lock().await.clone();
                if status.connected {
                    if let Some(name) = status.device_name {
                        return Ok(json!({
                            "devices": [{
                                "transport": "midi",
                                "name": name,
                                "address": name
                            }]
                        }));
                    }
                }
            }
            Ok(json!({ "devices": [] }))
        }
        "disconnect" => {
            midi_disconnect(&state).await?;
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
            let connected = if let Some(conn) = state.midi.lock().await.as_ref() {
                conn.status.lock().await.connected
            } else {
                false
            };
            Ok(json!({ "connected": connected }))
        }
        "midi_list_ports" => {
            let ports = midi_list_ports(&state).await?;
            Ok(json!({ "ports": ports }))
        }
        "midi_connect" => {
            let port_name = req
                .params
                .get("port_name")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string());
            let info = midi_connect(&state, port_name).await?;
            Ok(json!({ "device": info }))
        }
        "midi_disconnect" => {
            midi_disconnect(&state).await?;
            Ok(json!({}))
        }
        "midi_status" => {
            if let Some(conn) = state.midi.lock().await.as_ref() {
                let status = conn.status.lock().await.clone();
                Ok(json!(status))
            } else {
                Ok(json!(MidiStatus {
                    connected: false,
                    device_name: None
                }))
            }
        }
        "buffer_clear" => {
            // Ensure any late RX packets queued before the clear don't get appended after.
            state.rx_gen.fetch_add(1, Ordering::SeqCst);
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

            // Important: release the buffer lock before doing CPU-heavy compression.
            // Otherwise the MIDI RX callback can block on the mutex and drop packets / disconnect.
            let snapshot = state
                .buffer
                .lock()
                .map_err(|_| anyhow!("buffer lock poisoned"))?;
            let bytes = buffer::rx_snapshot(&*snapshot);
            drop(snapshot);

            let buffer_len_bytes = bytes.len();
            let (time_values, data_values) =
                sampler::compress_bits(&bytes, range_start, range_end, number_bins);
            Ok(json!({
                "buffer_len_bytes": buffer_len_bytes,
                "time_values": time_values,
                "data_values": data_values
            }))
        }
        "buffer_build_signed_raw_timings" => {
            // Release lock before doing CPU-heavy formatting.
            let snapshot = state
                .buffer
                .lock()
                .map_err(|_| anyhow!("buffer lock poisoned"))?;
            let bytes = buffer::rx_snapshot(&*snapshot);
            drop(snapshot);
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

pub(crate) async fn create_bridge_state() -> Result<Arc<BridgeState>> {
    let (event_tx, _) = broadcast::channel::<Vec<u8>>(1024);
    let (rx_queue_tx, rx_queue_rx) = mpsc::channel::<RxQueuedPacket>(RX_QUEUE_CAPACITY);

    let state = Arc::new(BridgeState {
        midi: Arc::new(AsyncMutex::new(None)),
        midi_system: Arc::new(AsyncMutex::new(None)),
        buffer: Arc::new(Mutex::new(Buffer::default())),
        rx_notify: Arc::new(Notify::new()),
        rx_queue_tx,
        rx_drop: Arc::new(AtomicBool::new(false)),
        rx_queue_dropped: Arc::new(AtomicU64::new(0)),
        rx_gen: Arc::new(AtomicU64::new(0)),
        in_flight: Arc::new(AsyncMutex::new(())),
        event_tx,
    });

    tokio::spawn(rx_queue_worker(Arc::clone(&state), rx_queue_rx));

    Ok(state)
}

fn midi_new_system() -> Result<MidiSystem> {
    let mut in_ = MidiInput::new("emwaver-midi-in").context("failed to init MIDI input")?;
    in_.ignore(Ignore::None);
    let out = MidiOutput::new("emwaver-midi-out").context("failed to init MIDI output")?;
    Ok(MidiSystem { in_, out })
}

async fn midi_ensure_system(state: &BridgeState) -> Result<()> {
    let mut guard = state.midi_system.lock().await;
    if guard.is_none() {
        *guard = Some(midi_new_system()?);
    }
    Ok(())
}

async fn midi_take_system(state: &BridgeState) -> Result<MidiSystem> {
    let mut guard = state.midi_system.lock().await;
    if let Some(system) = guard.take() {
        return Ok(system);
    }
    drop(guard);
    midi_new_system()
}

fn emwaver_usb_midi_present() -> bool {
    let Ok(ctx) = rusb::Context::new() else {
        return false;
    };
    let Ok(devices) = ctx.devices() else {
        return false;
    };
    devices.iter().any(|device| {
        device
            .device_descriptor()
            .is_ok_and(|desc| desc.vendor_id() == EMWAVER_USB_MIDI_VID && desc.product_id() == EMWAVER_USB_MIDI_PID)
    })
}

async fn midi_list_ports(state: &BridgeState) -> Result<Vec<String>> {
    // Keep one long-lived MIDI client per daemon to avoid transient init failures.
    midi_ensure_system(state).await?;
    let guard = state.midi_system.lock().await;
    let Some(system) = guard.as_ref() else {
        bail!("MIDI not initialized");
    };

    let midi_in = &system.in_;
    let midi_out = &system.out;

    let mut in_names = HashMap::<String, usize>::new();
    for (idx, port) in midi_in.ports().iter().enumerate() {
        if let Ok(name) = midi_in.port_name(port) {
            in_names.entry(name).or_insert(idx);
        }
    }

    let mut names = Vec::new();
    for port in midi_out.ports().iter() {
        let Ok(name) = midi_out.port_name(port) else { continue };
        if in_names.contains_key(&name) {
            names.push(name);
        }
    }

    names.sort();
    names.dedup();

    // CoreMIDI can keep endpoint objects around even after USB unplug. Filter EMWaver's
    // port name by checking USB presence so "Refresh ports" reflects physical reality.
    if !emwaver_usb_midi_present() {
        names.retain(|name| !name.contains("EMWaver USB MIDI"));
    }
    Ok(names)
}

fn find_midi_out_port_by_name(
    midi_out: &MidiOutput,
    name: &str,
) -> Result<Option<midir::MidiOutputPort>> {
    for port in midi_out.ports() {
        let Ok(port_name) = midi_out.port_name(&port) else { continue };
        if port_name == name || port_name.contains(name) {
            return Ok(Some(port));
        }
    }
    Ok(None)
}

fn find_midi_in_port_by_name(midi_in: &MidiInput, name: &str) -> Result<Option<midir::MidiInputPort>> {
    for port in midi_in.ports() {
        let Ok(port_name) = midi_in.port_name(&port) else { continue };
        if port_name == name || port_name.contains(name) {
            return Ok(Some(port));
        }
    }
    Ok(None)
}

async fn midi_disconnect(state: &BridgeState) -> Result<()> {
    // Drop any in-flight queued RX bytes after disconnect.
    state.rx_gen.fetch_add(1, Ordering::SeqCst);
    let existing = { state.midi.lock().await.take() };
    if let Some(conn) = existing {
        {
            let mut s = conn.status.lock().await;
            s.connected = false;
            s.device_name = None;
        }
        let _ = emit_event(state, "disconnected", json!({ "transport": "midi" }));
    }
    Ok(())
}

async fn midi_connect(state: &BridgeState, port_name: Option<String>) -> Result<DeviceInfo> {
    // Drop any queued RX bytes from a previous session.
    state.rx_gen.fetch_add(1, Ordering::SeqCst);
    let requested = port_name
        .as_deref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if let Some(conn) = state.midi.lock().await.as_ref() {
        let status = conn.status.lock().await.clone();
        if status.connected {
            if requested.is_none() || status.device_name.as_deref() == requested.as_deref() {
                return Ok(DeviceInfo {
                    transport: "midi",
                    name: status.device_name.clone(),
                    address: status.device_name.clone().unwrap_or_default(),
                });
            }
        }
    }

    let _ = midi_disconnect(state).await;

    let chosen = match requested {
        Some(p) => p,
        None => {
            let ports = midi_list_ports(state).await?;
            let Some(first) = ports.into_iter().next() else {
                bail!("no USB MIDI ports found");
            };
            first
        }
    };

    let rx_queue_tx = state.rx_queue_tx.clone();
    let rx_queue_dropped = Arc::clone(&state.rx_queue_dropped);
    let rx_gen = Arc::clone(&state.rx_gen);

    let MidiSystem { in_: midi_in, out: midi_out } = midi_take_system(state).await?;

    let out_port = find_midi_out_port_by_name(&midi_out, &chosen)?
        .ok_or_else(|| anyhow!("MIDI output port not found: {chosen}"))?;
    let in_port =
        find_midi_in_port_by_name(&midi_in, &chosen)?.ok_or_else(|| anyhow!("MIDI input port not found: {chosen}"))?;

    let out_conn = midi_out
        .connect(&out_port, "emwaver-midi-out-conn")
        .context("failed to connect MIDI output")?;
    let out = Arc::new(Mutex::new(out_conn));

    let in_conn = midi_in
        .connect(
            &in_port,
            "emwaver-midi-in-conn",
            move |_stamp, message, _| {
                let Ok(Some(pkt)) = midi_sysex::decode_packet64(message) else { return };

                let ts_ms = now_ms();
                let generation = rx_gen.load(Ordering::Relaxed);
                if rx_queue_tx
                    .try_send(RxQueuedPacket { pkt, ts_ms, generation })
                    .is_err()
                {
                    rx_queue_dropped.fetch_add(1, Ordering::Relaxed);
                }
            },
            (),
        )
        .context("failed to connect MIDI input")?;

    let status = Arc::new(AsyncMutex::new(MidiStatus {
        connected: true,
        device_name: Some(chosen.clone()),
    }));

    *state.midi.lock().await = Some(MidiConnection {
        out,
        _in: in_conn,
        status: Arc::clone(&status),
    });

    let _ = emit_event(
        state,
        "connected",
        json!({ "transport": "midi", "address": chosen, "name": chosen }),
    );

    Ok(DeviceInfo {
        transport: "midi",
        name: Some(chosen.clone()),
        address: chosen,
    })
}

async fn midi_write_packet(state: &BridgeState, bytes: Vec<u8>) -> Result<()> {
    let out = {
        let guard = state.midi.lock().await;
        guard
            .as_ref()
            .map(|c| Arc::clone(&c.out))
            .ok_or_else(|| anyhow!("not connected"))?
    };

    let packet = make_packet64(&bytes).map_err(|e| anyhow!(e))?;
    let sysex = midi_sysex::encode_packet64(&packet);

    timeout(
        Duration::from_millis(750),
        tokio::task::spawn_blocking(move || {
            let mut conn = out.lock().map_err(|_| anyhow!("midi output lock poisoned"))?;
            conn.send(&sysex).context("failed to send MIDI SysEx")?;
            Ok::<(), anyhow::Error>(())
        }),
    )
    .await
    .map_err(|_| anyhow!("timeout writing to MIDI"))?
    .map_err(|e| anyhow!("task join failed: {e}"))??;

    if let Ok(mut guard) = state.buffer.lock() {
        buffer::append_tx_packet(&mut *guard, &packet, now_ms());
    }
    Ok(())
}

async fn write_active(state: &BridgeState, bytes: Vec<u8>) -> Result<()> {
    let midi_connected = match state.midi.lock().await.as_ref() {
        Some(conn) => conn.status.lock().await.connected,
        None => false,
    };
    if midi_connected {
        return midi_write_packet(state, bytes).await;
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
    let midi_connected = match state.midi.lock().await.as_ref() {
        Some(conn) => conn.status.lock().await.connected,
        None => false,
    };
    if midi_connected {
        return midi_transmit_buffer(state, data).await;
    }
    bail!("not connected");
}

async fn midi_transmit_buffer(state: &BridgeState, data: Vec<u8>) -> Result<()> {
    state.rx_drop.store(true, Ordering::SeqCst);
    struct RxDropGuard(Arc<AtomicBool>);
    impl Drop for RxDropGuard {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }
    let _rx_drop_guard = RxDropGuard(Arc::clone(&state.rx_drop));
    if data.is_empty() {
        bail!("buffer is empty");
    }

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

    let profile = tx::UsbTxProfile::default();
    let packet_size = PACKET_SIZE;
    let total_bytes = data.len();

    // Use the event stream for BS parsing; on some platforms the buffer cursor can drift
    // during long TX bursts, but rx_bytes events remain reliable.
    let mut events = state.event_tx.subscribe();
    while events.try_recv().is_ok() {}

    let mut last_status: u16 = 0;
    let mut have_status = false;
    let mut last_emitted_status: Option<u16> = None;

    let start = tokio::time::Instant::now();
    let mut sent_at_packets: i64 = 0;

    let mut sent_bytes = 0usize;
    let mut last_emitted_progress_pct: i32 = -1;

    while sent_bytes < total_bytes {
        let mut saw_bs = false;
        while let Ok(msg) = events.try_recv() {
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
            if pkt.len() == PACKET_SIZE {
                if let Some(status) = status::parse_bs(&pkt) {
                    last_status = status;
                    have_status = true;
                    saw_bs = true;
                }
            }
        }

        if saw_bs && last_emitted_status != Some(last_status) {
            last_emitted_status = Some(last_status);
            let _ = emit_event(state, "bs", json!({ "value": last_status }));
        }

        let end = (sent_bytes + packet_size).min(total_bytes);
        let chunk = &data[sent_bytes..end];
        midi_write_packet(state, chunk.to_vec()).await?;
        sent_bytes = end;
        sent_at_packets = sent_at_packets.saturating_add(1);

        // Important: adjust relative to the ideal base schedule (non-cumulative), otherwise
        // repeated "speed up" nudges can run away and burst-send using stale BS values.
        let mut send_at_ns = sent_at_packets.saturating_mul(profile.period_ns);
        if have_status {
            send_at_ns = tx::usb_adjust_deadline_ns(profile, send_at_ns, last_status as i32);
        }

        let now_ns = start.elapsed().as_nanos() as i64;
        let sleep_ns = send_at_ns.saturating_sub(now_ns);
        if sleep_ns > 0 {
            tokio::time::sleep(Duration::from_nanos(sleep_ns as u64)).await;
        }

        let pct = ((sent_bytes as f64 / total_bytes as f64) * 100.0).floor() as i32;
        if pct != last_emitted_progress_pct && (pct % 5 == 0 || pct == 100) {
            last_emitted_progress_pct = pct;
            let _ = emit_event(
                state,
                "tx_progress",
                json!({
                    "sent_bytes": sent_bytes,
                    "total_bytes": total_bytes,
                    "pct": pct,
                    "chunk_len": chunk.len(),
                    "packet_size": packet_size,
                    "period_ns": profile.period_ns,
                    "sleep_ns": sleep_ns.max(0),
                    "bs": last_status
                }),
            );
        }
    }

    if let Ok(mut guard) = state.buffer.lock() {
        guard.rx_bytes = saved_rx;
        guard.rx_ts_ms = saved_rx_ts;
        guard.rx_counter = saved_counter;
    }

    Ok(())
}

async fn rx_queue_worker(state: Arc<BridgeState>, mut rx: mpsc::Receiver<RxQueuedPacket>) {
    let mut last_dropped: u64 = 0;
    while let Some(item) = rx.recv().await {
        let current_gen = state.rx_gen.load(Ordering::Relaxed);
        if item.generation != current_gen {
            continue;
        }

        let dropped = state.rx_queue_dropped.load(Ordering::Relaxed);
        if dropped != last_dropped {
            last_dropped = dropped;
            let _ = emit_event(state.as_ref(), "rx_queue_dropped", json!({ "count": dropped }));
        }

        // Emit RX event first so command/BS listeners don't get blocked by buffer work.
        let bytes_b64 = base64::engine::general_purpose::STANDARD.encode(item.pkt);
        let payload = BridgeEvent {
            event: "rx_bytes",
            data: json!({ "bytes_b64": bytes_b64, "ts_ms": item.ts_ms }),
        };
        if let Ok(mut out) = serde_json::to_vec(&payload) {
            out.push(b'\n');
            let _ = state.event_tx.send(out);
        }

        if !state.rx_drop.load(Ordering::Relaxed) {
            if let Ok(mut guard) = state.buffer.lock() {
                buffer::append_rx_bytes(&mut *guard, &item.pkt, item.ts_ms);
            }
        }
        state.rx_notify.notify_waiters();
    }
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
        u8::from_str_radix(stripped.trim(), 16)
            .map_err(|_| anyhow!("invalid hex byte: {content}"))?
    } else if let Ok(hex) = u8::from_str_radix(content.trim(), 16) {
        hex
    } else {
        content
            .trim()
            .parse::<u8>()
            .map_err(|_| anyhow!("invalid byte value: {content}"))?
    };

    Ok(value)
}
