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

use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use base64::Engine as _;
#[cfg(target_os = "macos")]
use coremidi::{Client as CoreMidiClient, Destination, Destinations, InputPort, OutputPort, PacketBuffer, Source, Sources};
#[cfg(not(target_os = "macos"))]
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
pub struct BridgeRequest {
    pub id: u64,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct BridgeResponse {
    pub id: u64,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<BridgeError>,
}

#[derive(Debug, Serialize)]
pub struct BridgeError {
    pub message: String,
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

#[derive(Debug, Clone, Serialize)]
struct MidiStatus {
    connected: bool,
    device_name: Option<String>,
}

struct MidiConnection {
    #[cfg(target_os = "macos")]
    out: Arc<OutputPort>,
    #[cfg(target_os = "macos")]
    destination: Destination,
    #[cfg(target_os = "macos")]
    source: Source,
    #[cfg(not(target_os = "macos"))]
    out: Arc<Mutex<Option<midir::MidiOutputConnection>>>,
    #[cfg(not(target_os = "macos"))]
    in_conn: Option<midir::MidiInputConnection<()>>,
    status: Arc<AsyncMutex<MidiStatus>>,
}

struct MidiIo {
    #[cfg(target_os = "macos")]
    _client: CoreMidiClient,
    #[cfg(target_os = "macos")]
    input: InputPort,
    #[cfg(target_os = "macos")]
    output: Arc<OutputPort>,
    #[cfg(not(target_os = "macos"))]
    midi_in: MidiInput,
    #[cfg(not(target_os = "macos"))]
    midi_out: MidiOutput,
}

pub struct BridgeState {
    midi: Arc<AsyncMutex<Option<MidiConnection>>>,
    midi_io: Arc<AsyncMutex<Option<MidiIo>>>,
    midi_last_ports: Arc<AsyncMutex<Vec<String>>>,
    buffer: Arc<Mutex<Buffer>>,
    rx_notify: Arc<Notify>,
    rx_queue_tx: mpsc::Sender<RxQueuedPacket>,
    rx_drop: Arc<AtomicBool>,
    rx_queue_dropped: Arc<AtomicU64>,
    rx_gen: Arc<AtomicU64>,
    in_flight: Arc<AsyncMutex<()>>,
    pub event_tx: broadcast::Sender<Vec<u8>>,
}

impl BridgeState {
    pub async fn has_midi_connection(&self) -> bool {
        self.midi.lock().await.is_some()
    }
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

pub fn send_json_line(tx: &mpsc::UnboundedSender<Vec<u8>>, value: &impl Serialize) -> Result<()> {
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

pub async fn dispatch_request(
    state: Arc<BridgeState>,
    req: BridgeRequest,
) -> Result<serde_json::Value> {
    let method = req.method.as_str();

    match method {
        "hello" => Ok(json!({
            "protocol": 2,
            "event_schema": 2,
            "cli": env!("CARGO_PKG_VERSION"),
            "transports": ["usb"],
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
                                "transport": "usb",
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

pub async fn create_bridge_state() -> Result<Arc<BridgeState>> {
    let (event_tx, _) = broadcast::channel::<Vec<u8>>(1024);
    let (rx_queue_tx, rx_queue_rx) = mpsc::channel::<RxQueuedPacket>(RX_QUEUE_CAPACITY);

    let state = Arc::new(BridgeState {
        midi: Arc::new(AsyncMutex::new(None)),
        midi_io: Arc::new(AsyncMutex::new(None)),
        midi_last_ports: Arc::new(AsyncMutex::new(Vec::new())),
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

    let midi_io = match midi_io_init_for_state(state.as_ref()) {
        Ok(v) => Some(v),
        Err(err) => {
            eprintln!("[midi] init failed during startup: {err:#}");
            None
        }
    };
    *state.midi_io.lock().await = midi_io;

    Ok(state)
}

#[cfg(target_os = "macos")]
fn midi_io_init_for_state(state: &BridgeState) -> Result<MidiIo> {
    let client =
        CoreMidiClient::new("emwaver-desktop").map_err(|status| anyhow!("CoreMIDI client init failed: {status}"))?;
    let output = client
        .output_port("emwaver-usb-out")
        .map_err(|status| anyhow!("CoreMIDI output port init failed: {status}"))?;

    let rx_queue_tx = state.rx_queue_tx.clone();
    let rx_queue_dropped = Arc::clone(&state.rx_queue_dropped);
    let rx_gen = Arc::clone(&state.rx_gen);

    // CoreMIDI may split SysEx across packets; reassemble before handing to our 64B decoder.
    let mut in_sysex = false;
    let mut sysex_buf: Vec<u8> = Vec::with_capacity(256);
    let input = client
        .input_port("emwaver-usb-in", move |packet_list| {
            for packet in packet_list.iter() {
                for &b in packet.data() {
                    if !in_sysex {
                        if b == 0xF0 {
                            in_sysex = true;
                            sysex_buf.clear();
                            sysex_buf.push(b);
                        }
                        continue;
                    }

                    sysex_buf.push(b);
                    if b != 0xF7 {
                        if sysex_buf.len() > 1024 {
                            in_sysex = false;
                            sysex_buf.clear();
                        }
                        continue;
                    }

                    if let Ok(Some(pkt)) = midi_sysex::decode_packet64(&sysex_buf) {
                        let ts_ms = now_ms();
                        let generation = rx_gen.load(Ordering::Relaxed);
                        if rx_queue_tx
                            .try_send(RxQueuedPacket { pkt, ts_ms, generation })
                            .is_err()
                        {
                            rx_queue_dropped.fetch_add(1, Ordering::Relaxed);
                        }
                    }

                    in_sysex = false;
                    sysex_buf.clear();
                }
            }
        })
        .map_err(|status| anyhow!("CoreMIDI input port init failed: {status}"))?;

    Ok(MidiIo {
        _client: client,
        input,
        output: Arc::new(output),
    })
}

#[cfg(not(target_os = "macos"))]
fn midi_io_init_for_state(_state: &BridgeState) -> Result<MidiIo> {
    // CoreMIDI/midir can occasionally fail to initialize if it is queried right as the
    // system is handling device (un)plug events. Treat this as transient and retry briefly.
    let mut last_err: Option<anyhow::Error> = None;
    for attempt in 0..5 {
        match MidiInput::new("emwaver-usb-in") {
            Ok(mut in_) => {
                in_.ignore(Ignore::None);
                let out = MidiOutput::new("emwaver-usb-out").context("failed to init USB output")?;
                return Ok(MidiIo { midi_in: in_, midi_out: out });
            }
            Err(err) => {
                last_err = Some(err.into());
                if attempt < 4 {
                    std::thread::sleep(std::time::Duration::from_millis(80));
                }
            }
        }
    }
    Err(last_err
        .unwrap_or_else(|| anyhow!("unknown MIDI init error"))
        .context("failed to init USB input"))
}

pub fn emwaver_usb_midi_present() -> Result<bool> {
    let ctx = rusb::Context::new().context("failed to init libusb context")?;
    let devices = ctx.devices().context("failed to list libusb devices")?;
    Ok(devices.iter().any(|device| {
        device
            .device_descriptor()
            .is_ok_and(|desc| desc.vendor_id() == EMWAVER_USB_MIDI_VID && desc.product_id() == EMWAVER_USB_MIDI_PID)
    }))
}

#[cfg(target_os = "macos")]
async fn midi_list_ports(state: &BridgeState) -> Result<Vec<String>> {
    let cached = state.midi_last_ports.lock().await.clone();

    if let Some(conn) = state.midi.lock().await.as_ref() {
        let status = conn.status.lock().await.clone();
        if cached.is_empty() {
            if let Some(name) = status.device_name {
                return Ok(vec![name]);
            }
        }
        return Ok(cached);
    }

    let mut source_names = Vec::new();
    for source in Sources {
        let name = source.display_name().or_else(|| source.name());
        if let Some(name) = name {
            if !name.trim().is_empty() {
                source_names.push(name);
            }
        }
    }

    let mut names = Vec::new();
    for destination in Destinations {
        let Some(out_name) = destination.display_name().or_else(|| destination.name()) else {
            continue;
        };
        let out_name = out_name.trim();
        if out_name.is_empty() {
            continue;
        }

        let has_matching_in = source_names.iter().any(|in_name| {
            in_name == out_name || in_name.contains(out_name) || out_name.contains(in_name)
        });
        if has_matching_in {
            names.push(out_name.to_string());
        }
    }

    names.sort();
    names.dedup();

    const EMWAVER_USB_DEVICE_NAMES: [&str; 2] = ["EMWaver USB", "EMWaver USB MIDI"];
    for name in &mut names {
        if EMWAVER_USB_DEVICE_NAMES.iter().any(|n| name.contains(n)) {
            *name = EMWAVER_USB_DEVICE_NAMES[0].to_string();
        }
    }

    names.sort();
    names.dedup();

    *(state.midi_last_ports.lock().await) = names.clone();
    Ok(names)
}

#[cfg(not(target_os = "macos"))]
async fn midi_list_ports(state: &BridgeState) -> Result<Vec<String>> {
    // Important: CoreMIDI initialization can be fragile if repeated very frequently inside a
    // long-lived GUI app. We initialize the MIDI client once during bridge startup (on the main
    // thread) and reuse it for enumeration/connection.
    let cached = state.midi_last_ports.lock().await.clone();

    // If we're connected, return the cached list (and at least the connected device name).
    if let Some(conn) = state.midi.lock().await.as_ref() {
        let status = conn.status.lock().await.clone();
        if cached.is_empty() {
            if let Some(name) = status.device_name {
                return Ok(vec![name]);
            }
        }
        return Ok(cached);
    }

    let io_guard = state.midi_io.lock().await;
    let Some(io) = io_guard.as_ref() else {
        return Ok(cached);
    };

    let mut names = Vec::new();
    let in_names = io
        .midi_in
        .ports()
        .iter()
        .filter_map(|port| io.midi_in.port_name(port).ok())
        .collect::<Vec<_>>();

    for port in io.midi_out.ports() {
        let Ok(out_name) = io.midi_out.port_name(&port) else { continue };
        let has_matching_in = in_names.iter().any(|in_name| {
            in_name == &out_name || in_name.contains(&out_name) || out_name.contains(in_name)
        });
        if has_matching_in {
            names.push(out_name);
        }
    }

    names.sort();
    names.dedup();

    const EMWAVER_USB_DEVICE_NAMES: [&str; 2] = ["EMWaver USB", "EMWaver USB MIDI"];

    // Normalize EMWaver's transport name for end users (we call it "USB" everywhere, even
    // though the underlying transport is class-compliant USB MIDI).
    for name in &mut names {
        if EMWAVER_USB_DEVICE_NAMES.iter().any(|n| name.contains(n)) {
            *name = EMWAVER_USB_DEVICE_NAMES[0].to_string();
        }
    }

    names.sort();
    names.dedup();

    *(state.midi_last_ports.lock().await) = names.clone();
    Ok(names)
}

#[cfg(target_os = "macos")]
fn coremidi_matches(chosen: &str, candidate: &str) -> bool {
    candidate == chosen || candidate.contains(chosen) || chosen.contains(candidate)
}

#[cfg(target_os = "macos")]
fn find_coremidi_destination_by_name(name: &str) -> Option<Destination> {
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    for destination in Destinations {
        let Some(candidate) = destination.display_name().or_else(|| destination.name()) else {
            continue;
        };
        if coremidi_matches(name, candidate.trim()) {
            return Some(destination);
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn find_coremidi_source_by_name(name: &str) -> Option<Source> {
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    for source in Sources {
        let Some(candidate) = source.display_name().or_else(|| source.name()) else {
            continue;
        };
        if coremidi_matches(name, candidate.trim()) {
            return Some(source);
        }
    }
    None
}

#[cfg(not(target_os = "macos"))]
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

#[cfg(not(target_os = "macos"))]
fn find_midi_in_port_by_name(midi_in: &MidiInput, name: &str) -> Result<Option<midir::MidiInputPort>> {
    for port in midi_in.ports() {
        let Ok(port_name) = midi_in.port_name(&port) else { continue };
        if port_name == name || port_name.contains(name) {
            return Ok(Some(port));
        }
    }
    Ok(None)
}

#[cfg(target_os = "macos")]
async fn midi_disconnect(state: &BridgeState) -> Result<()> {
    state.rx_gen.fetch_add(1, Ordering::SeqCst);
    let existing = { state.midi.lock().await.take() };
    if let Some(conn) = existing {
        if let Some(io) = state.midi_io.lock().await.as_ref() {
            let _ = io.input.disconnect_source(&conn.source);
        }
        let _ = conn.destination.flush();

        {
            let mut s = conn.status.lock().await;
            s.connected = false;
            s.device_name = None;
        }
        let _ = emit_event(state, "disconnected", json!({ "transport": "usb" }));
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
async fn midi_disconnect(state: &BridgeState) -> Result<()> {
    // Drop any in-flight queued RX bytes after disconnect.
    state.rx_gen.fetch_add(1, Ordering::SeqCst);
    let existing = { state.midi.lock().await.take() };
    if let Some(conn) = existing {
        let mut restored_in: Option<MidiInput> = None;
        let mut restored_out: Option<MidiOutput> = None;

        if let Ok(mut out_guard) = conn.out.lock() {
            if let Some(out_conn) = out_guard.take() {
                restored_out = Some(out_conn.close());
            }
        }

        if let Some(in_conn) = conn.in_conn {
            let (midi_in, _data) = in_conn.close();
            restored_in = Some(midi_in);
        }

        if let (Some(midi_in), Some(midi_out)) = (restored_in, restored_out) {
            *state.midi_io.lock().await = Some(MidiIo { midi_in, midi_out });
        }

        {
            let mut s = conn.status.lock().await;
            s.connected = false;
            s.device_name = None;
        }
        let _ = emit_event(state, "disconnected", json!({ "transport": "usb" }));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
async fn midi_connect(state: &BridgeState, port_name: Option<String>) -> Result<DeviceInfo> {
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
                    transport: "usb",
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
                bail!("no USB devices found");
            };
            first
        }
    };

    let io_guard = state.midi_io.lock().await;
    let Some(io) = io_guard.as_ref() else {
        bail!("MIDI subsystem is not initialized (restart Desktop app)");
    };

    let destination = find_coremidi_destination_by_name(&chosen)
        .ok_or_else(|| anyhow!("USB output port not found: {chosen}"))?;
    let source = find_coremidi_source_by_name(&chosen).ok_or_else(|| anyhow!("USB input port not found: {chosen}"))?;

    io.input
        .connect_source(&source)
        .map_err(|status| anyhow!("failed to connect USB input: {status}"))?;

    let status = Arc::new(AsyncMutex::new(MidiStatus {
        connected: true,
        device_name: Some(chosen.clone()),
    }));

    *state.midi.lock().await = Some(MidiConnection {
        out: Arc::clone(&io.output),
        destination: destination.clone(),
        source: source.clone(),
        status: Arc::clone(&status),
    });

    let _ = emit_event(
        state,
        "connected",
        json!({ "transport": "usb", "address": chosen, "name": chosen }),
    );

    Ok(DeviceInfo {
        transport: "usb",
        name: Some(chosen.clone()),
        address: chosen,
    })
}

#[cfg(not(target_os = "macos"))]
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
                    transport: "usb",
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
                bail!("no USB devices found");
            };
            first
        }
    };

    let rx_queue_tx = state.rx_queue_tx.clone();
    let rx_queue_dropped = Arc::clone(&state.rx_queue_dropped);
    let rx_gen = Arc::clone(&state.rx_gen);

    let mut io_guard = state.midi_io.lock().await;
    let io = io_guard
        .take()
        .ok_or_else(|| anyhow!("MIDI subsystem is not initialized (restart Desktop app)"))?;
    drop(io_guard);

    let out_port = find_midi_out_port_by_name(&io.midi_out, &chosen)?
        .ok_or_else(|| anyhow!("USB output port not found: {chosen}"))?;
    let in_port = find_midi_in_port_by_name(&io.midi_in, &chosen)?
        .ok_or_else(|| anyhow!("USB input port not found: {chosen}"))?;

    let out_conn = match io
        .midi_out
        .connect(&out_port, "emwaver-usb-out-conn")
    {
        Ok(v) => v,
        Err(err) => {
            let message = err.to_string();
            *state.midi_io.lock().await = Some(MidiIo {
                midi_in: io.midi_in,
                midi_out: err.into_inner(),
            });
            return Err(anyhow!("failed to connect USB output: {message}"));
        }
    };
    let out = Arc::new(Mutex::new(Some(out_conn)));

    let in_conn = match io.midi_in.connect(
            &in_port,
            "emwaver-usb-in-conn",
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
        ) {
        Ok(v) => v,
        Err(err) => {
            let message = err.to_string();
            let mut restored_out: Option<MidiOutput> = None;
            if let Ok(mut guard) = out.lock() {
                if let Some(out_conn) = guard.take() {
                    restored_out = Some(out_conn.close());
                }
            }
            if let Some(midi_out) = restored_out {
                *state.midi_io.lock().await = Some(MidiIo {
                    midi_in: err.into_inner(),
                    midi_out,
                });
            }
            return Err(anyhow!("failed to connect USB input: {message}"));
        }
    };

    let status = Arc::new(AsyncMutex::new(MidiStatus {
        connected: true,
        device_name: Some(chosen.clone()),
    }));

    *state.midi.lock().await = Some(MidiConnection {
        out,
        in_conn: Some(in_conn),
        status: Arc::clone(&status),
    });

    let _ = emit_event(
        state,
        "connected",
        json!({ "transport": "usb", "address": chosen, "name": chosen }),
    );

    Ok(DeviceInfo {
        transport: "usb",
        name: Some(chosen.clone()),
        address: chosen,
    })
}

#[cfg(target_os = "macos")]
async fn midi_write_packet(state: &BridgeState, bytes: Vec<u8>) -> Result<()> {
    let (out, destination) = {
        let guard = state.midi.lock().await;
        let conn = guard.as_ref().ok_or_else(|| anyhow!("not connected"))?;
        (Arc::clone(&conn.out), conn.destination.clone())
    };

    let packet = make_packet64(&bytes).map_err(|e| anyhow!(e))?;
    let sysex = midi_sysex::encode_packet64(&packet);
    let packet_list = PacketBuffer::new(0, &sysex);

    out.send(&destination, &packet_list)
        .map_err(|status| anyhow!("failed to send USB packet: {status}"))?;

    if let Ok(mut guard) = state.buffer.lock() {
        buffer::append_tx_packet(&mut *guard, &packet, now_ms());
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
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
            let mut conn = out.lock().map_err(|_| anyhow!("usb output lock poisoned"))?;
            let conn = conn.as_mut().ok_or_else(|| anyhow!("not connected"))?;
            conn.send(&sysex).context("failed to send USB packet")?;
            Ok::<(), anyhow::Error>(())
        }),
    )
    .await
    .map_err(|_| anyhow!("timeout writing to USB"))?
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

pub async fn write_bytes(state: &BridgeState, bytes: Vec<u8>) -> Result<()> {
    write_active(state, bytes).await
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
                bail!("device events channel closed")
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

pub async fn send_packet_command_bytes(
    state: &BridgeState,
    bytes: Vec<u8>,
    timeout_ms: u64,
    packets: u32,
) -> Result<Vec<u8>> {
    send_packet_command(state, bytes, timeout_ms, packets).await
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

pub async fn transmit_buffer_bytes(state: &BridgeState, data: Vec<u8>) -> Result<()> {
    transmit_buffer_active(state, data).await
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
