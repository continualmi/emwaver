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
use std::io::{self, Write};
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use btleplug::api::{
    Central, CentralEvent, CentralState, Characteristic, Manager as _, Peripheral as _, ScanFilter,
};
use btleplug::platform::{Adapter, Manager, Peripheral};
use serde::Serialize;
use tokio::runtime::Runtime;
use tokio::time::{sleep, timeout};
use tokio_stream::StreamExt;
use uuid::Uuid;

const SERVICE_UUID: Uuid = uuid::uuid!("45c7158e-0c3b-4e90-a847-452a15b14191");
const CMD_CHAR_UUID: Uuid = uuid::uuid!("46c7158e-0c3b-4e90-a847-452a15b14191");
const NOTIF_CHAR_UUID: Uuid = uuid::uuid!("47c7158e-0c3b-4e90-a847-452a15b14191");

#[derive(Debug, Clone, Serialize)]
struct ListedDevice {
    address: String,
    name: Option<String>,
}

pub fn list_devices(timeout_ms: u64, all: bool, name: String, json: bool) -> Result<()> {
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async { list_devices_async(timeout_ms, all, name, json).await })
}

async fn list_devices_async(timeout_ms: u64, all: bool, name: String, json: bool) -> Result<()> {
    let adapter = pick_adapter().await?;

    let mut events = adapter
        .events()
        .await
        .context("failed to subscribe to adapter events")?;

    adapter
        // CoreBluetooth-backed platforms can be unreliable with service UUID scan filters;
        // filter in software (by advertised local_name) for consistent behavior.
        .start_scan(ScanFilter::default())
        .await
        .context("failed to start BLE scan")?;

    let mut seen: HashMap<String, Peripheral> = HashMap::new();
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

        if !all {
            if props.local_name.as_deref() != Some(name.as_str()) {
                continue;
            }
        }

        let address = peripheral.address().to_string();
        seen.insert(address, peripheral);
    }

    adapter.stop_scan().await.ok();

    let mut devices: Vec<ListedDevice> = Vec::with_capacity(seen.len());
    for (address, peripheral) in seen {
        let name = peripheral
            .properties()
            .await
            .ok()
            .flatten()
            .and_then(|p| p.local_name);
        devices.push(ListedDevice { address, name });
    }
    devices.sort_by(|a, b| a.address.cmp(&b.address));

    if json {
        println!("{}", serde_json::to_string(&devices).unwrap_or_else(|_| "[]".to_string()));
        return Ok(());
    }

    if devices.is_empty() {
        if all {
            println!("No BLE devices found.");
        } else {
            println!("No EMWaver devices found.");
        }
        return Ok(());
    }

    for device in devices {
        let name = device.name.unwrap_or_else(|| "(no name)".to_string());
        println!("{name}\t{}", device.address);
    }

    Ok(())
}

pub fn connect_device(
    address: Option<String>,
    name: String,
    timeout_ms: u64,
    stay: bool,
    verbose: bool,
) -> Result<()> {
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async { connect_device_async(address, name, timeout_ms, stay, verbose).await })
}

async fn connect_device_async(
    address: Option<String>,
    name: String,
    timeout_ms: u64,
    stay: bool,
    verbose: bool,
) -> Result<()> {
    let adapter = pick_adapter().await?;

    let peripheral = resolve_device(&adapter, address, name, timeout_ms).await?;
    let addr = peripheral.address().to_string();

    if !peripheral.is_connected().await? {
        peripheral
            .connect()
            .await
            .context("failed to connect to device")?;
    }
    peripheral
        .discover_services()
        .await
        .context("failed to discover services")?;

    let (_cmd_char, notif_char) = locate_characteristics(&peripheral)?;
    if stay {
        peripheral
            .subscribe(&notif_char)
            .await
            .context("failed to enable notifications")?;
        println!("Connected to {addr}. Listening for notifications (Ctrl-C to stop)...");

        let mut notifications = peripheral
            .notifications()
            .await
            .context("failed to listen for notifications")?;

        loop {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {
                    break;
                }
                maybe_evt = notifications.next() => {
                    let Some(evt) = maybe_evt else { break };
                    if evt.uuid != NOTIF_CHAR_UUID { continue; }
                    render_notification(&evt.value, verbose);
                }
            }
        }

        let _ = timeout(Duration::from_secs(2), peripheral.unsubscribe(&notif_char)).await;
        let _ = timeout(Duration::from_secs(2), peripheral.disconnect()).await;
        return Ok(());
    }

    println!("ok connected {addr}");
    let _ = timeout(Duration::from_secs(2), peripheral.disconnect()).await;
    Ok(())
}

async fn pick_adapter() -> Result<Adapter> {
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

    Ok(adapter)
}

async fn resolve_device(
    adapter: &Adapter,
    address: Option<String>,
    name: String,
    timeout_ms: u64,
) -> Result<Peripheral> {
    let mut events = adapter
        .events()
        .await
        .context("failed to subscribe to adapter events")?;

    adapter
        // Match the shell's behavior: scan broadly and filter by local_name.
        .start_scan(ScanFilter::default())
        .await
        .context("failed to start BLE scan")?;

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

        if props.local_name.as_deref() != Some(name.as_str()) {
            continue;
        }

        if let Some(ref wanted) = address {
            if peripheral.address().to_string() != *wanted {
                continue;
            }
        }

        adapter.stop_scan().await.ok();
        // Give the stack a moment after stopping scanning; some platforms are flaky otherwise.
        sleep(Duration::from_millis(100)).await;
        return Ok(peripheral);
    }

    adapter.stop_scan().await.ok();
    if let Some(wanted) = address {
        bail!("timed out scanning for {name} ({wanted})");
    }
    bail!("timed out scanning for {name}");
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

fn render_notification(data: &[u8], verbose: bool) {
    if data.is_empty() {
        return;
    }

    let ascii = data
        .iter()
        .map(|&b| match b {
            0x20..=0x7E => b as char,
            _ => '.',
        })
        .collect::<String>();

    print!("\r\x1b[K");
    if verbose {
        let hex = data
            .iter()
            .map(|b| format!("{:02X}", b))
            .collect::<Vec<_>>()
            .join(" ");
        println!("hex:   {hex}");
        println!("ascii: {ascii}");
    } else {
        println!("{ascii}");
    }
    io::stdout().flush().ok();
}
