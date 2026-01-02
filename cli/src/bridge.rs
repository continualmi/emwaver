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
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::runtime::Runtime;
use tokio::sync::mpsc;
use tokio::sync::{Mutex as AsyncMutex, Notify};
use tokio::time::timeout;
use tokio_stream::StreamExt;
use uuid::Uuid;

use emwaver_buffer_core::buffer::{self, Buffer};
use emwaver_buffer_core::packet::{make_packet64, PACKET_SIZE};
use emwaver_buffer_core::status;

const SERVICE_UUID: Uuid = uuid::uuid!("45c7158e-0c3b-4e90-a847-452a15b14191");
const CMD_CHAR_UUID: Uuid = uuid::uuid!("46c7158e-0c3b-4e90-a847-452a15b14191");
const NOTIF_CHAR_UUID: Uuid = uuid::uuid!("47c7158e-0c3b-4e90-a847-452a15b14191");

const DEFAULT_SCAN_TIMEOUT_MS: u64 = 6_000;
const DEFAULT_DEVICE_NAME: &str = "EMWaver";

#[derive(Debug, Deserialize)]
struct BridgeRequest {
    id: u64,
    method: String,
    #[serde(default)]
    params: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct BridgeResponse {
    id: u64,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<BridgeError>,
}

#[derive(Debug, Serialize)]
struct BridgeError {
    message: String,
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

struct BridgeState {
    adapter: Adapter,
    peripherals: Arc<AsyncMutex<HashMap<String, Peripheral>>>,
    connected: Arc<AsyncMutex<Option<Peripheral>>>,
    chars: Arc<AsyncMutex<Option<(Characteristic, Characteristic)>>>,
    buffer: Arc<Mutex<Buffer>>,
    rx_notify: Arc<Notify>,
    in_flight: Arc<AsyncMutex<()>>,
    out_tx: mpsc::UnboundedSender<Vec<u8>>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn run_bridge() -> Result<()> {
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async { run_bridge_async().await })
}

async fn run_bridge_async() -> Result<()> {
    let manager = Manager::new()
        .await
        .context("failed to initialize BLE manager")?;
    let adapters = manager
        .adapters()
        .await
        .context("failed to list BLE adapters")?;
    let adapter = adapters
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("no BLE adapters found"))?;

    match adapter
        .adapter_state()
        .await
        .context("failed to query Bluetooth power state")?
    {
        CentralState::PoweredOff => bail!("bluetooth appears to be off"),
        CentralState::Unknown => {
            eprintln!("warning: bluetooth adapter state unknown; discovery may fail");
        }
        CentralState::PoweredOn => {}
    }

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

    let state = Arc::new(BridgeState {
        adapter,
        peripherals: Arc::new(AsyncMutex::new(HashMap::new())),
        connected: Arc::new(AsyncMutex::new(None)),
        chars: Arc::new(AsyncMutex::new(None)),
        buffer: Arc::new(Mutex::new(Buffer::default())),
        rx_notify: Arc::new(Notify::new()),
        in_flight: Arc::new(AsyncMutex::new(())),
        out_tx,
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

        send_json_line(&state, &response)?;
    }

    // Drain pending stdout lines before exiting so callers don't lose responses.
    drop(state);
    let _ = timeout(Duration::from_secs(1), writer_task).await;

    Ok(())
}

fn send_json_line(state: &BridgeState, value: &impl Serialize) -> Result<()> {
    let mut buf = serde_json::to_vec(value).context("failed to encode json")?;
    buf.push(b'\n');
    state
        .out_tx
        .send(buf)
        .map_err(|_| anyhow!("stdout channel closed"))?;
    Ok(())
}

fn emit_event(state: &BridgeState, event: &str, data: serde_json::Value) -> Result<()> {
    send_json_line(state, &BridgeEvent { event, data })
}

async fn dispatch_request(state: Arc<BridgeState>, req: BridgeRequest) -> Result<serde_json::Value> {
    let method = req.method.as_str();

    match method {
        "hello" => Ok(json!({
            "protocol": 1,
            "cli": env!("CARGO_PKG_VERSION"),
            "transports": ["ble"],
            "features": {
                "buffer": true,
                "send_command": true
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
            let guard = state.connected.lock().await;
            if let Some(peripheral) = guard.as_ref() {
                Ok(json!({
                    "devices": [{
                        "transport": "ble",
                        "name": DEFAULT_DEVICE_NAME,
                        "address": peripheral.address().to_string()
                    }]
                }))
            } else {
                Ok(json!({ "devices": [] }))
            }
        }
        "disconnect" => {
            ble_disconnect(&state).await?;
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
            let bytes = ble_send_command(&state, &text, timeout_ms, packets).await?;
            let bytes_b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
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
            ble_write(&state, bytes).await?;
            Ok(json!({}))
        }
        "connection_status" => {
            let connected = state.connected.lock().await.is_some();
            Ok(json!({ "connected": connected }))
        }
        "buffer_clear" => {
            if let Ok(mut guard) = state.buffer.lock() {
                buffer::clear(&mut *guard);
            }
            Ok(json!({}))
        }
        "buffer_read_rx_since" => {
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
        (peripheral.clone(), chars.0)
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

async fn ble_list_devices(
    state: &BridgeState,
    timeout_ms: u64,
    name: Option<String>,
) -> Result<Vec<DeviceInfo>> {
    {
        let mut guard = state.peripherals.lock().await;
        guard.clear();
    }

    let mut events = state
        .adapter
        .events()
        .await
        .context("failed to subscribe to adapter events")?;

    state
        .adapter
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

        let peripheral = state
            .adapter
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

    state.adapter.stop_scan().await.ok();

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
    // Best-effort disconnect any existing connection.
    let _ = ble_disconnect(state).await;

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

    let (cmd_char, notif_char) = locate_characteristics(&peripheral)?;

    peripheral.subscribe(&notif_char).await?;

    {
        let mut guard = state.connected.lock().await;
        *guard = Some(peripheral.clone());
    }
    {
        let mut guard = state.chars.lock().await;
        *guard = Some((cmd_char.clone(), notif_char.clone()));
    }

    spawn_notifications(
        Arc::new(peripheral.clone()),
        Arc::clone(&state.buffer),
        Arc::clone(&state.rx_notify),
        state.out_tx.clone(),
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
        (peripheral.clone(), chars.0)
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

fn spawn_notifications(
    peripheral: Arc<Peripheral>,
    buffer: Arc<Mutex<Buffer>>,
    rx_notify: Arc<Notify>,
    out_tx: mpsc::UnboundedSender<Vec<u8>>,
) {
    tokio::spawn(async move {
        let Ok(mut stream) = peripheral.notifications().await else {
            eprintln!("bridge: failed to listen for notifications");
            return;
        };

        while let Some(event) = stream.next().await {
            if event.uuid != NOTIF_CHAR_UUID {
                continue;
            }
            let ts_ms = now_ms();
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
                let _ = out_tx.send(buf);
            }
        }
    });
}

fn locate_characteristics(peripheral: &Peripheral) -> Result<(Characteristic, Characteristic)> {
    let mut cmd_char = None;
    let mut notif_char = None;

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
        }
    }

    let cmd = cmd_char.ok_or_else(|| anyhow!("command characteristic not found"))?;
    let notif = notif_char.ok_or_else(|| anyhow!("notification characteristic not found"))?;

    Ok((cmd, notif))
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
