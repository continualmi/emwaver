use anyhow::{Context, Result};
use btleplug::api::{Central, CharPropFlags, Manager as _, Peripheral as _, ScanFilter, WriteType};
use btleplug::platform::{Adapter, Manager, Peripheral};
use futures::StreamExt;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tokio::runtime::Runtime;
use tracing::warn;
use uuid::{uuid, Uuid};

use crate::protocol::{
    decode_sysex_to_superframe, encode_superframe, make_superframe, LANE_SIZE, SUPERFRAME_SIZE,
};

pub const EMW_BLE_SERVICE_UUID: Uuid = uuid!("45C7158E-0C3B-4E90-A847-452A15B14191");
pub const EMW_BLE_COMMAND_UUID: Uuid = uuid!("46C7158E-0C3B-4E90-A847-452A15B14191");
pub const EMW_BLE_NOTIFY_UUID: Uuid = uuid!("47C7158E-0C3B-4E90-A847-452A15B14191");

#[derive(Debug, Clone)]
pub struct BleDeviceInfo {
    pub id: String,
    pub name: String,
    pub address: String,
}

struct BleState {
    capture_buffer: Vec<u8>,
    rx_packets: Vec<Vec<u8>>,
    waiting_for_response: bool,
    response_data: Option<Vec<u8>>,
    is_sampler_streaming_active: bool,
}

impl Default for BleState {
    fn default() -> Self {
        Self {
            capture_buffer: Vec::new(),
            rx_packets: Vec::new(),
            waiting_for_response: false,
            response_data: None,
            is_sampler_streaming_active: false,
        }
    }
}

#[derive(Default)]
struct SharedBleState {
    state: Mutex<BleState>,
    cv: Condvar,
}

pub struct BleDevice {
    rt: Runtime,
    peripheral: Peripheral,
    command_characteristic: btleplug::api::Characteristic,
    shared: Arc<SharedBleState>,
}

pub fn list_ble_devices(scan_ms: u64) -> Result<Vec<BleDeviceInfo>> {
    let rt = Runtime::new().context("failed to create BLE runtime")?;
    rt.block_on(async move {
        let adapter = first_adapter().await?;
        adapter
            .start_scan(ScanFilter::default())
            .await
            .context("failed to start EMWaver BLE scan")?;
        tokio::time::sleep(Duration::from_millis(scan_ms.max(250))).await;
        let peripherals = adapter
            .peripherals()
            .await
            .context("failed to list BLE peripherals")?;
        let mut out = Vec::new();
        for (index, peripheral) in peripherals.into_iter().enumerate() {
            if !is_emwaver_peripheral(&peripheral).await {
                continue;
            }
            let props = peripheral.properties().await.ok().flatten();
            let name = props
                .as_ref()
                .and_then(|p| p.local_name.clone())
                .unwrap_or_else(|| "EMWaver BLE".to_string());
            let address = props
                .as_ref()
                .map(|p| p.address.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            out.push(BleDeviceInfo {
                id: index.to_string(),
                name,
                address,
            });
        }
        Ok(out)
    })
}

impl BleDevice {
    pub fn connect_auto(scan_ms: u64) -> Result<Arc<Self>> {
        let rt = Runtime::new().context("failed to create BLE runtime")?;
        let (peripheral, command_characteristic, notify_characteristic) =
            rt.block_on(async move {
                let adapter = first_adapter().await?;
                scan_for_emwaver(&adapter, scan_ms).await
            })?;

        let shared = Arc::new(SharedBleState::default());
        let device = Arc::new(Self {
            rt,
            peripheral,
            command_characteristic,
            shared,
        });
        device.start_notifications(notify_characteristic)?;
        Ok(device)
    }

    pub fn send_command(&self, cmd_lane: &[u8], timeout_ms: u64) -> Result<Option<Vec<u8>>> {
        {
            let mut st = self.shared.state.lock().unwrap();
            st.rx_packets.clear();
            st.waiting_for_response = true;
            st.response_data = None;
            if cmd_lane.len() >= 2 && cmd_lane[0] == 0x60 {
                if cmd_lane[1] == 0x00 {
                    st.is_sampler_streaming_active = true;
                } else if cmd_lane[1] == 0x01 {
                    st.is_sampler_streaming_active = false;
                }
            }
        }

        let sf = make_superframe(Some(cmd_lane), None);
        self.send_superframe(&sf)?;

        let deadline = Instant::now() + Duration::from_millis(timeout_ms.max(1));
        let mut st = self.shared.state.lock().unwrap();
        while st.response_data.is_none() {
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            let remaining = deadline.saturating_duration_since(now);
            let (guard, _res) = self.shared.cv.wait_timeout(st, remaining).unwrap();
            st = guard;
        }

        st.waiting_for_response = false;
        Ok(st.response_data.take())
    }

    pub fn get_buffer(&self) -> Vec<u8> {
        self.shared.state.lock().unwrap().capture_buffer.clone()
    }

    pub fn clear_buffer(&self) {
        let mut st = self.shared.state.lock().unwrap();
        st.capture_buffer.clear();
        st.rx_packets.clear();
    }

    fn send_superframe(&self, superframe: &[u8; SUPERFRAME_SIZE]) -> Result<()> {
        let sysex = encode_superframe(superframe);
        self.rt.block_on(async {
            let write_type = if self
                .command_characteristic
                .properties
                .contains(CharPropFlags::WRITE_WITHOUT_RESPONSE)
            {
                WriteType::WithoutResponse
            } else {
                WriteType::WithResponse
            };
            self.peripheral
                .write(&self.command_characteristic, &sysex, write_type)
                .await
                .context("BLE command write failed")
        })
    }

    fn start_notifications(
        &self,
        notify_characteristic: btleplug::api::Characteristic,
    ) -> Result<()> {
        let peripheral = self.peripheral.clone();
        let shared = self.shared.clone();
        self.rt.block_on(async {
            peripheral
                .subscribe(&notify_characteristic)
                .await
                .context("failed to subscribe to EMWaver BLE notifications")?;
            let mut notifications = peripheral
                .notifications()
                .await
                .context("failed to open BLE notification stream")?;
            tokio::spawn(async move {
                while let Some(notification) = notifications.next().await {
                    if let Err(err) = handle_ble_sysex(&shared, &notification.value) {
                        warn!("BLE SysEx decode error: {err:#}");
                    }
                }
            });
            Ok::<(), anyhow::Error>(())
        })
    }
}

async fn first_adapter() -> Result<Adapter> {
    let manager = Manager::new()
        .await
        .context("failed to create BLE manager")?;
    let adapters = manager
        .adapters()
        .await
        .context("failed to list BLE adapters")?;
    adapters.into_iter().next().context("no BLE adapter found")
}

async fn scan_for_emwaver(
    adapter: &Adapter,
    scan_ms: u64,
) -> Result<(
    Peripheral,
    btleplug::api::Characteristic,
    btleplug::api::Characteristic,
)> {
    adapter
        .start_scan(ScanFilter::default())
        .await
        .context("failed to start EMWaver BLE scan")?;
    tokio::time::sleep(Duration::from_millis(scan_ms.max(500))).await;

    let peripherals = adapter
        .peripherals()
        .await
        .context("failed to list BLE peripherals")?;
    for peripheral in peripherals {
        if !is_emwaver_peripheral(&peripheral).await {
            continue;
        }
        peripheral
            .connect()
            .await
            .context("failed to connect EMWaver BLE peripheral")?;
        peripheral
            .discover_services()
            .await
            .context("failed to discover EMWaver BLE services")?;
        let chars = peripheral.characteristics();
        let command = chars
            .iter()
            .find(|c| c.uuid == EMW_BLE_COMMAND_UUID && c.properties.contains(CharPropFlags::WRITE))
            .cloned()
            .or_else(|| {
                chars
                    .iter()
                    .find(|c| c.uuid == EMW_BLE_COMMAND_UUID)
                    .cloned()
            })
            .context("EMWaver BLE command characteristic not found")?;
        let notify = chars
            .iter()
            .find(|c| c.uuid == EMW_BLE_NOTIFY_UUID && c.properties.contains(CharPropFlags::NOTIFY))
            .cloned()
            .or_else(|| {
                chars
                    .iter()
                    .find(|c| c.uuid == EMW_BLE_NOTIFY_UUID)
                    .cloned()
            })
            .context("EMWaver BLE notify characteristic not found")?;
        return Ok((peripheral, command, notify));
    }

    anyhow::bail!("no EMWaver BLE peripheral found")
}

async fn is_emwaver_peripheral(peripheral: &Peripheral) -> bool {
    let Ok(Some(props)) = peripheral.properties().await else {
        return false;
    };
    if props
        .services
        .iter()
        .any(|uuid| *uuid == EMW_BLE_SERVICE_UUID)
    {
        return true;
    }
    props
        .local_name
        .as_deref()
        .map(|name| {
            let lower = name.to_lowercase();
            lower.contains("emw") || lower.contains("emwaver")
        })
        .unwrap_or(false)
}

fn handle_ble_sysex(shared: &SharedBleState, notification: &[u8]) -> Result<()> {
    let sysex = extract_sysex_frame(notification).context("notification did not contain SysEx")?;
    let sf = decode_sysex_to_superframe(sysex)?;
    let cmd_lane = &sf[0..LANE_SIZE];
    let stream_lane = &sf[LANE_SIZE..LANE_SIZE * 2];

    let cmd_empty = cmd_lane.iter().all(|&b| b == 0);
    let stream_empty = stream_lane.iter().all(|&b| b == 0);

    if !cmd_empty {
        store_rx_lane(shared, cmd_lane);
    }

    let sampler_active = shared.state.lock().unwrap().is_sampler_streaming_active;
    if !stream_empty || sampler_active {
        store_rx_lane(shared, stream_lane);
    }

    Ok(())
}

fn extract_sysex_frame(bytes: &[u8]) -> Option<&[u8]> {
    let start = bytes.iter().position(|b| *b == 0xf0)?;
    let end = bytes[start..]
        .iter()
        .position(|b| *b == 0xf7)
        .map(|offset| start + offset)?;
    Some(&bytes[start..=end])
}

fn store_rx_lane(shared: &SharedBleState, lane: &[u8]) {
    let mut st = shared.state.lock().unwrap();
    st.capture_buffer.extend_from_slice(lane);
    st.rx_packets.push(lane.to_vec());

    if st.waiting_for_response && st.response_data.is_none() {
        st.response_data = Some(lane.to_vec());
        shared.cv.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{encode_superframe, make_superframe};

    #[test]
    fn extracts_sysex_from_padded_ble_notification() {
        let frame = make_superframe(Some(&[0x80, 1, 2, 3]), None);
        let sysex = encode_superframe(&frame);
        let mut padded = sysex.clone();
        padded.resize(64, 0);

        assert_eq!(extract_sysex_frame(&padded), Some(sysex.as_slice()));
    }

    #[test]
    fn rejects_notification_without_sysex() {
        assert_eq!(extract_sysex_frame(&[0x80, 0, 0, 0]), None);
    }
}
