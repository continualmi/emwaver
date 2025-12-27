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

const OTA_SERVICE_UUID: Uuid = uuid::uuid!("45c7158e-0c3b-4e90-a847-452a15b14192");
const OTA_CTRL_CHAR_UUID: Uuid = uuid::uuid!("45c7158e-0c3b-4e90-a847-452a15b14193");
const OTA_DATA_CHAR_UUID: Uuid = uuid::uuid!("45c7158e-0c3b-4e90-a847-452a15b14194");
const OTA_STATUS_CHAR_UUID: Uuid = uuid::uuid!("45c7158e-0c3b-4e90-a847-452a15b14195");

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
    runtime.block_on(async { flash_async(file, &device_name, chunk_size, verbose).await })
}

async fn flash_async(file: PathBuf, device_name: &str, chunk_size: usize, verbose: bool) -> Result<()> {
    if chunk_size == 0 || chunk_size > 512 {
        bail!("chunk size must be in 1..=512");
    }

    let bytes = std::fs::read(&file)
        .with_context(|| format!("failed to read firmware file: {}", file.display()))?;
    if bytes.is_empty() {
        bail!("firmware file is empty");
    }

    let total = bytes.len() as u32;
    println!("Firmware: {} ({} bytes)", file.display(), total);

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
