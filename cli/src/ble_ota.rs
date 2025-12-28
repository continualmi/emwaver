/*
 * EMWaver CLI - BLE OTA
 * Copyright (C) 2025 Luís Marnoto
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

use std::path::PathBuf;
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use btleplug::api::{
    Central, CentralEvent, CentralState, Characteristic, Manager as _, Peripheral as _, ScanFilter,
    WriteType,
};
use btleplug::platform::{Adapter, Manager, Peripheral};
use sha2::{Digest as _, Sha256};
use tokio::runtime::Runtime;
use tokio::time::{sleep, timeout};
use tokio_stream::StreamExt;
use uuid::Uuid;

const STOCK_FIRMWARE_BIN: &[u8] = include_bytes!("../resources/ota/emwaveresp.bin");

const OTA_SERVICE_UUID: Uuid = uuid::uuid!("45c7158e-0c3b-4e90-a847-452a15b14192");
const OTA_CTRL_CHAR_UUID: Uuid = uuid::uuid!("45c7158e-0c3b-4e90-a847-452a15b14193");
const OTA_DATA_CHAR_UUID: Uuid = uuid::uuid!("45c7158e-0c3b-4e90-a847-452a15b14194");
const OTA_STATUS_CHAR_UUID: Uuid = uuid::uuid!("45c7158e-0c3b-4e90-a847-452a15b14195");

const OTA_WIFI_START: &[u8] = &[0x10];

#[derive(Debug, Clone, Copy)]
struct OtaStatus {
    code: u8,
    received: u32,
    total: u32,
    err: u8,
}

fn parse_ota_status(bytes: &[u8]) -> Option<OtaStatus> {
    if bytes.len() != 14 {
        return None;
    }
    if &bytes[0..3] != b"OTA" {
        return None;
    }
    if bytes[3] != 1 {
        return None;
    }

    let code = bytes[4];
    let received = u32::from_le_bytes([bytes[5], bytes[6], bytes[7], bytes[8]]);
    let total = u32::from_le_bytes([bytes[9], bytes[10], bytes[11], bytes[12]]);
    let err = bytes[13];

    Some(OtaStatus {
        code,
        received,
        total,
        err,
    })
}

pub fn flash(file: PathBuf, device_name: String, chunk_size: usize, verbose: bool) -> Result<()> {
    let runtime = Runtime::new().context("failed to create async runtime")?;
    let bytes = std::fs::read(&file)
        .with_context(|| format!("failed to read firmware file: {}", file.display()))?;
    runtime.block_on(async { flash_bytes_async(&bytes, &file.display().to_string(), &device_name, chunk_size, verbose).await })
}

pub fn flash_stock(device_name: String, chunk_size: usize, verbose: bool) -> Result<()> {
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async { flash_bytes_async(STOCK_FIRMWARE_BIN, "stock firmware", &device_name, chunk_size, verbose).await })
}

pub fn flash_wifi(file: PathBuf, device_name: String, verbose: bool) -> Result<()> {
    let runtime = Runtime::new().context("failed to create async runtime")?;
    let bytes = std::fs::read(&file)
        .with_context(|| format!("failed to read firmware file: {}", file.display()))?;
    runtime.block_on(async { flash_bytes_wifi_async(&bytes, &file.display().to_string(), &device_name, verbose).await })
}

pub fn flash_stock_wifi(device_name: String, verbose: bool) -> Result<()> {
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async { flash_bytes_wifi_async(STOCK_FIRMWARE_BIN, "stock firmware", &device_name, verbose).await })
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

async fn flash_bytes_async(bytes: &[u8], label: &str, device_name: &str, chunk_size: usize, verbose: bool) -> Result<()> {
    if chunk_size == 0 || chunk_size > 512 {
        bail!("chunk size must be in 1..=512");
    }

    if bytes.is_empty() {
        bail!("firmware file is empty");
    }

    let total = bytes.len() as u32;
    println!("Firmware: {label} ({total} bytes)");

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let sha = hasher.finalize();

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
        CentralState::PoweredOff => {
            println!("Bluetooth appears to be off. Enable Bluetooth and retry.");
            return Ok(());
        }
        CentralState::Unknown => {
            println!("Bluetooth adapter state is unknown. Discovery may fail if Bluetooth is disabled.");
        }
        CentralState::PoweredOn => {}
    }

    println!("Scanning for {device_name}...");
    let peripheral = discover_target(&adapter, device_name).await?;
    adapter.stop_scan().await.ok();

    let address = peripheral.address();
    println!("Connecting ({address})...");

    if !peripheral.is_connected().await? {
        peripheral.connect().await.context("failed to connect")?;
    }

    peripheral
        .discover_services()
        .await
        .context("failed to discover services")?;

    let (ctrl_char, data_char, status_char) = locate_ota_characteristics(&peripheral)?;

    peripheral
        .subscribe(&status_char)
        .await
        .context("failed to enable OTA status notifications")?;

    let mut notifications = peripheral
        .notifications()
        .await
        .context("failed to listen for notifications")?;

    let mut start = Vec::with_capacity(1 + 4 + 32);
    start.push(0x01);
    start.extend_from_slice(&total.to_le_bytes());
    start.extend_from_slice(&sha[..]);

    println!("Starting OTA session...");
    peripheral
        .write(&ctrl_char, &start, WriteType::WithResponse)
        .await
        .context("failed to write OTA start")?;

    let _ = timeout(Duration::from_secs(2), async {
        while let Some(event) = notifications.next().await {
            if event.uuid != OTA_STATUS_CHAR_UUID {
                continue;
            }
            if let Some(status) = parse_ota_status(&event.value) {
                if verbose {
                    println!("OTA status: {:?}", status);
                }
                break;
            }
        }
    })
    .await;

    println!("Uploading...");
    let mut sent = 0usize;
    let mut last_printed = 0usize;

    for chunk in bytes.chunks(chunk_size) {
        peripheral
            .write(&data_char, chunk, WriteType::WithoutResponse)
            .await
            .context("failed to write OTA data chunk")?;
        sent += chunk.len();

        if sent - last_printed >= 64 * 1024 || sent == bytes.len() {
            last_printed = sent;
            println!("Sent {sent}/{total} bytes");
        }

        sleep(Duration::from_millis(3)).await;
    }

    println!("Finalizing...");
    peripheral
        .write(&ctrl_char, &[0x03], WriteType::WithResponse)
        .await
        .context("failed to write OTA end")?;

    let result = timeout(Duration::from_secs(30), async {
        while let Some(event) = notifications.next().await {
            if event.uuid != OTA_STATUS_CHAR_UUID {
                continue;
            }
            if let Some(status) = parse_ota_status(&event.value) {
                println!(
                    "Device status: code=0x{:02x} received={} total={} err=0x{:02x}",
                    status.code, status.received, status.total, status.err
                );
                match status.code {
                    0x13 => return Ok(()), // SUCCESS
                    0x14 | 0x15 => bail!("OTA failed (code=0x{:02x}, err=0x{:02x})", status.code, status.err),
                    _ => {}
                }
            }
        }
        bail!("OTA status stream ended unexpectedly")
    })
    .await;

    let _ = peripheral.unsubscribe(&status_char).await;
    let _ = peripheral.disconnect().await;

    result.context("timed out waiting for OTA completion")?
}

async fn upload_over_wifi(bytes: &[u8], sha_hex: &str, verbose: bool) -> Result<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    let addr = "192.168.4.1:80";

    let mut stream = timeout(Duration::from_secs(10), TcpStream::connect(addr))
        .await
        .map_err(|_| anyhow!("Timed out connecting to {addr} (connect to Wi‑Fi 'EMWaver-OTA' first)"))?
        .context("failed to connect to OTA SoftAP")?;

    let request = format!(
        "POST /ota HTTP/1.1\r\nHost: 192.168.4.1\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nX-Emwaver-Sha256: {}\r\nConnection: close\r\n\r\n",
        bytes.len(),
        sha_hex
    );
    stream.write_all(request.as_bytes()).await?;

    let mut sent = 0usize;
    let mut last_printed = 0usize;
    for chunk in bytes.chunks(16 * 1024) {
        stream.write_all(chunk).await?;
        sent += chunk.len();
        if sent - last_printed >= 64 * 1024 || sent == bytes.len() {
            last_printed = sent;
            if verbose {
                println!("WiFi sent {sent}/{} bytes", bytes.len());
            }
        }
    }
    stream.shutdown().await.ok();

    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.ok();
    let response_str = String::from_utf8_lossy(&response);
    let status_line = response_str.lines().next().unwrap_or_default();
    if !(status_line.starts_with("HTTP/1.1 200") || status_line.starts_with("HTTP/1.0 200")) {
        bail!("OTA HTTP upload failed: {status_line}");
    }

    Ok(())
}

async fn flash_bytes_wifi_async(bytes: &[u8], label: &str, device_name: &str, verbose: bool) -> Result<()> {
    if bytes.is_empty() {
        bail!("firmware file is empty");
    }

    let total = bytes.len() as u32;
    println!("Firmware: {label} ({total} bytes)");

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let sha = hasher.finalize();
    let sha_hex = bytes_to_hex_lower(&sha[..]);

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

    println!("Scanning for {device_name}...");
    let peripheral = discover_target(&adapter, device_name).await?;
    adapter.stop_scan().await.ok();

    let address = peripheral.address();
    println!("Connecting ({address})...");

    if !peripheral.is_connected().await? {
        peripheral.connect().await.context("failed to connect")?;
    }

    peripheral
        .discover_services()
        .await
        .context("failed to discover services")?;

    let (ctrl_char, _data_char, status_char) = locate_ota_characteristics(&peripheral)?;

    peripheral
        .subscribe(&status_char)
        .await
        .context("failed to enable OTA status notifications")?;

    let mut notifications = peripheral
        .notifications()
        .await
        .context("failed to listen for notifications")?;

    println!("Starting WiFi OTA mode (SoftAP)...");
    peripheral
        .write(&ctrl_char, OTA_WIFI_START, WriteType::WithResponse)
        .await
        .context("failed to start WiFi OTA mode")?;

    println!("Connect your computer to Wi‑Fi '{0}', then the upload will begin.", "EMWaver-OTA");

    timeout(Duration::from_secs(120), async {
        loop {
            match upload_over_wifi(bytes, &sha_hex, verbose).await {
                Ok(()) => return Ok::<(), anyhow::Error>(()),
                Err(err) => {
                    if verbose {
                        println!("Waiting for Wi‑Fi connection... ({err})");
                    }
                    sleep(Duration::from_secs(2)).await;
                }
            }
        }
    })
    .await
    .map_err(|_| anyhow!("Timed out waiting for Wi‑Fi upload (connect to EMWaver-OTA and retry)"))??;

    println!("Waiting for device to finalize...");
    let result = timeout(Duration::from_secs(30), async {
        while let Some(event) = notifications.next().await {
            if event.uuid != OTA_STATUS_CHAR_UUID {
                continue;
            }
            if let Some(status) = parse_ota_status(&event.value) {
                if verbose {
                    println!("OTA status: {:?}", status);
                }
                match status.code {
                    0x13 => return Ok(()), // SUCCESS
                    0x14 | 0x15 => bail!("OTA failed (code=0x{:02x}, err=0x{:02x})", status.code, status.err),
                    _ => {}
                }
            }
        }
        bail!("OTA status stream ended unexpectedly")
    })
    .await;

    let _ = peripheral.unsubscribe(&status_char).await;
    let _ = peripheral.disconnect().await;

    result.context("timed out waiting for OTA completion")?
}

async fn discover_target(adapter: &Adapter, device_name: &str) -> Result<Peripheral> {
    let mut events = adapter
        .events()
        .await
        .context("failed to subscribe to adapter events")?;

    adapter
        .start_scan(ScanFilter::default())
        .await
        .context("failed to start BLE scan")?;

    let timeout_total = Duration::from_secs(20);
    let mut elapsed = Duration::from_millis(0);

    loop {
        tokio::select! {
            maybe_event = events.next() => {
                if let Some(event) = maybe_event {
                    if let Some(peripheral) = handle_event(adapter, event, device_name).await? {
                        println!("Found device: {}", peripheral.address());
                        return Ok(peripheral);
                    }
                } else {
                    bail!("BLE adapter event stream ended unexpectedly");
                }
            }
            _ = sleep(Duration::from_millis(500)) => {
                elapsed += Duration::from_millis(500);
                if elapsed >= timeout_total {
                    bail!("timed out scanning for {device_name}");
                }
            }
        }
    }
}

async fn handle_event(adapter: &Adapter, event: CentralEvent, device_name: &str) -> Result<Option<Peripheral>> {
    match event {
        CentralEvent::DeviceDiscovered(id)
        | CentralEvent::DeviceUpdated(id)
        | CentralEvent::DeviceConnected(id)
        | CentralEvent::ManufacturerDataAdvertisement { id, manufacturer_data: _ } => {
            let peripheral = adapter
                .peripheral(&id)
                .await
                .context("failed to access peripheral")?;
            if let Some(props) = peripheral
                .properties()
                .await
                .context("failed to read peripheral properties")?
            {
                if let Some(name) = props.local_name {
                    if name == device_name {
                        return Ok(Some(peripheral));
                    }
                }
            }
            Ok(None)
        }
        CentralEvent::DeviceDisconnected(_) => Ok(None),
        _ => Ok(None),
    }
}

fn locate_ota_characteristics(
    peripheral: &Peripheral,
) -> Result<(Characteristic, Characteristic, Characteristic)> {
    let mut ctrl = None;
    let mut data = None;
    let mut status = None;

    for service in peripheral.services() {
        if service.uuid != OTA_SERVICE_UUID {
            continue;
        }

        for characteristic in service.characteristics.iter() {
            if characteristic.uuid == OTA_CTRL_CHAR_UUID {
                ctrl = Some(characteristic.clone());
            }
            if characteristic.uuid == OTA_DATA_CHAR_UUID {
                data = Some(characteristic.clone());
            }
            if characteristic.uuid == OTA_STATUS_CHAR_UUID {
                status = Some(characteristic.clone());
            }
        }
    }

    Ok((
        ctrl.ok_or_else(|| anyhow!("OTA control characteristic not found"))?,
        data.ok_or_else(|| anyhow!("OTA data characteristic not found"))?,
        status.ok_or_else(|| anyhow!("OTA status characteristic not found"))?,
    ))
}
