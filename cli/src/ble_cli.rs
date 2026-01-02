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
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use btleplug::api::{
    Central, CentralEvent, CentralState, Manager as _, Peripheral as _, ScanFilter,
};
use btleplug::platform::{Adapter, Manager, Peripheral};
use serde::Serialize;
use tokio::runtime::Runtime;
use tokio::time::timeout;
use tokio_stream::StreamExt;

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
