use crate::usb_midi_sysex::{
    decode_sysex_to_superframe, encode_superframe_to_sysex, UsbMidiSysexAccumulator,
};
use crate::{
    EmwFrame, EmwaverTransport, TransportDescriptor, TransportError, TransportId, TransportResult,
};
use async_trait::async_trait;
use btleplug::api::{
    Central, Characteristic, Manager as _, Peripheral as _, ScanFilter, ValueNotification,
    WriteType,
};
use btleplug::platform::{Adapter, Manager, Peripheral};
use emwaver_linux_core::TransportKind;
use futures::StreamExt;
use std::pin::Pin;
use std::time::Duration;
use tokio::sync::Mutex;
use uuid::Uuid;

pub const BLE_SERVICE_UUID: &str = "45C7158E-0C3B-4E90-A847-452A15B14191";
pub const BLE_COMMAND_UUID: &str = "46C7158E-0C3B-4E90-A847-452A15B14191";
pub const BLE_NOTIFY_UUID: &str = "47C7158E-0C3B-4E90-A847-452A15B14191";
const BLE_SCAN_DURATION: Duration = Duration::from_millis(1600);

type NotificationStream = Pin<Box<dyn futures::Stream<Item = ValueNotification> + Send>>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BleTarget {
    pub adapter: String,
    pub device_address: String,
    pub display_name: String,
}

impl BleTarget {
    pub fn new(
        adapter: impl Into<String>,
        device_address: impl Into<String>,
        display_name: impl Into<String>,
    ) -> TransportResult<Self> {
        let adapter = normalize_adapter(adapter.into())?;
        let device_address = normalize_ble_address(device_address.into())?;
        let display_name = display_name.into().trim().to_string();
        Ok(Self {
            adapter,
            device_address,
            display_name: if display_name.is_empty() {
                "EMWaver BLE".to_string()
            } else {
                display_name
            },
        })
    }

    pub fn id(&self) -> String {
        format!("ble:{}:{}", self.adapter, self.device_address)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BleDeviceCandidate {
    pub target: BleTarget,
    pub rssi: Option<i16>,
    pub service_uuid: String,
    pub command_uuid: String,
    pub notify_uuid: String,
}

#[derive(Default, Debug)]
pub struct LinuxBleManager;

impl LinuxBleManager {
    pub fn scan(&self) -> TransportResult<Vec<BleDeviceCandidate>> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|err| TransportError::Ble(format!("failed to create BLE runtime: {err}")))?;
        runtime.block_on(self.scan_async(BLE_SCAN_DURATION))
    }

    pub async fn scan_async(&self, duration: Duration) -> TransportResult<Vec<BleDeviceCandidate>> {
        let service_uuid = uuid(BLE_SERVICE_UUID)?;
        let manager = Manager::new()
            .await
            .map_err(|err| TransportError::Ble(format!("BlueZ manager failed: {err}")))?;
        let adapters = manager
            .adapters()
            .await
            .map_err(|err| TransportError::Ble(format!("BlueZ adapter query failed: {err}")))?;
        let mut candidates = Vec::new();

        for (index, adapter) in adapters.into_iter().enumerate() {
            adapter
                .start_scan(ScanFilter {
                    services: vec![service_uuid],
                })
                .await
                .map_err(|err| TransportError::Ble(format!("BLE scan failed: {err}")))?;
            tokio::time::sleep(duration).await;
            let peripherals = adapter.peripherals().await.map_err(|err| {
                TransportError::Ble(format!("BLE peripheral query failed: {err}"))
            })?;
            for peripheral in peripherals {
                let Some(candidate) = candidate_from_peripheral(index, &peripheral).await? else {
                    continue;
                };
                if !candidates.iter().any(|existing: &BleDeviceCandidate| {
                    existing.target.id() == candidate.target.id()
                }) {
                    candidates.push(candidate);
                }
            }
            let _ = adapter.stop_scan().await;
        }
        Ok(candidates)
    }

    pub fn manual_target(
        &self,
        adapter: impl Into<String>,
        device_address: impl Into<String>,
        display_name: impl Into<String>,
    ) -> TransportResult<BleTarget> {
        BleTarget::new(adapter, device_address, display_name)
    }
}

pub struct LinuxBleTransport {
    target: BleTarget,
    peripheral: Option<Peripheral>,
    command_characteristic: Option<Characteristic>,
    notify_characteristic: Option<Characteristic>,
    notifications: Mutex<Option<NotificationStream>>,
    sysex_accumulator: UsbMidiSysexAccumulator,
}

impl std::fmt::Debug for LinuxBleTransport {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("LinuxBleTransport")
            .field("target", &self.target)
            .field("connected", &self.peripheral.is_some())
            .finish()
    }
}

impl LinuxBleTransport {
    pub fn new(target: BleTarget) -> Self {
        Self {
            target,
            peripheral: None,
            command_characteristic: None,
            notify_characteristic: None,
            notifications: Mutex::new(None),
            sysex_accumulator: UsbMidiSysexAccumulator::new(),
        }
    }
}

#[async_trait]
impl EmwaverTransport for LinuxBleTransport {
    fn descriptor(&self) -> TransportDescriptor {
        TransportDescriptor {
            id: TransportId(self.target.id()),
            kind: TransportKind::Ble,
            display_name: self.target.display_name.clone(),
            hardware_uid: None,
            firmware_version: None,
        }
    }

    async fn connect(&mut self) -> TransportResult<()> {
        let (adapter, peripheral) = find_peripheral_for_target(&self.target).await?;
        adapter
            .stop_scan()
            .await
            .map_err(|err| TransportError::Ble(format!("BLE scan stop failed: {err}")))?;
        peripheral
            .connect()
            .await
            .map_err(|err| TransportError::Ble(format!("BLE connect failed: {err}")))?;
        peripheral
            .discover_services()
            .await
            .map_err(|err| TransportError::Ble(format!("BLE service discovery failed: {err}")))?;
        let command_uuid = uuid(BLE_COMMAND_UUID)?;
        let notify_uuid = uuid(BLE_NOTIFY_UUID)?;
        let characteristics = peripheral.characteristics();
        let command_characteristic = characteristics
            .iter()
            .find(|characteristic| characteristic.uuid == command_uuid)
            .cloned()
            .ok_or_else(|| {
                TransportError::Ble("BLE command characteristic was not found".to_string())
            })?;
        let notify_characteristic = characteristics
            .iter()
            .find(|characteristic| characteristic.uuid == notify_uuid)
            .cloned()
            .ok_or_else(|| {
                TransportError::Ble("BLE notify characteristic was not found".to_string())
            })?;
        let notifications = peripheral
            .notifications()
            .await
            .map_err(|err| TransportError::Ble(format!("BLE notification stream failed: {err}")))?;
        peripheral
            .subscribe(&notify_characteristic)
            .await
            .map_err(|err| TransportError::Ble(format!("BLE subscribe failed: {err}")))?;

        self.peripheral = Some(peripheral);
        self.command_characteristic = Some(command_characteristic);
        self.notify_characteristic = Some(notify_characteristic);
        *self.notifications.lock().await = Some(notifications);
        Ok(())
    }

    async fn send_frame(&mut self, frame: EmwFrame) -> TransportResult<()> {
        let peripheral = self
            .peripheral
            .as_ref()
            .ok_or(TransportError::NotConnected)?;
        let characteristic = self
            .command_characteristic
            .as_ref()
            .ok_or(TransportError::NotConnected)?;
        let sysex = encode_superframe_to_sysex(&frame.bytes)
            .map_err(|err| TransportError::Ble(format!("BLE SysEx encode failed: {err}")))?;
        peripheral
            .write(characteristic, &sysex, WriteType::WithResponse)
            .await
            .map_err(|err| TransportError::Ble(format!("BLE write failed: {err}")))
    }

    async fn next_frame(&mut self) -> TransportResult<EmwFrame> {
        let notify_uuid = uuid(BLE_NOTIFY_UUID)?;
        let mut notifications = self.notifications.lock().await;
        let stream = notifications.as_mut().ok_or(TransportError::NotConnected)?;
        while let Some(notification) = stream.next().await {
            if notification.uuid == notify_uuid {
                for sysex in self.sysex_accumulator.feed(&notification.value) {
                    if let Ok(superframe) = decode_sysex_to_superframe(&sysex) {
                        return Ok(EmwFrame {
                            bytes: superframe.to_vec(),
                        });
                    }
                }
            }
        }
        Err(TransportError::NotConnected)
    }

    async fn close(&mut self) -> TransportResult<()> {
        if let (Some(peripheral), Some(characteristic)) = (
            self.peripheral.as_ref(),
            self.notify_characteristic.as_ref(),
        ) {
            let _ = peripheral.unsubscribe(characteristic).await;
        }
        if let Some(peripheral) = self.peripheral.take() {
            let _ = peripheral.disconnect().await;
        }
        self.command_characteristic = None;
        self.notify_characteristic = None;
        *self.notifications.lock().await = None;
        Ok(())
    }
}

async fn candidate_from_peripheral(
    adapter_index: usize,
    peripheral: &Peripheral,
) -> TransportResult<Option<BleDeviceCandidate>> {
    let Some(properties) = peripheral
        .properties()
        .await
        .map_err(|err| TransportError::Ble(format!("BLE properties failed: {err}")))?
    else {
        return Ok(None);
    };
    let service_uuid = uuid(BLE_SERVICE_UUID)?;
    if !properties
        .services
        .iter()
        .any(|service| *service == service_uuid)
    {
        return Ok(None);
    }
    let address = normalize_ble_address(properties.address.to_string())?;
    let display_name = properties
        .local_name
        .unwrap_or_else(|| "EMWaver BLE".to_string());
    Ok(Some(BleDeviceCandidate {
        target: BleTarget::new(format!("hci{adapter_index}"), address, display_name)?,
        rssi: properties.rssi,
        service_uuid: BLE_SERVICE_UUID.to_string(),
        command_uuid: BLE_COMMAND_UUID.to_string(),
        notify_uuid: BLE_NOTIFY_UUID.to_string(),
    }))
}

async fn find_peripheral_for_target(target: &BleTarget) -> TransportResult<(Adapter, Peripheral)> {
    let manager = Manager::new()
        .await
        .map_err(|err| TransportError::Ble(format!("BlueZ manager failed: {err}")))?;
    let adapters = manager
        .adapters()
        .await
        .map_err(|err| TransportError::Ble(format!("BlueZ adapter query failed: {err}")))?;
    let adapter_index = target
        .adapter
        .strip_prefix("hci")
        .and_then(|index| index.parse::<usize>().ok())
        .ok_or_else(|| TransportError::Ble(format!("unsupported adapter {}", target.adapter)))?;
    let Some(adapter) = adapters.into_iter().nth(adapter_index) else {
        return Err(TransportError::Ble(format!(
            "Bluetooth adapter {} was not found",
            target.adapter
        )));
    };
    let service_uuid = uuid(BLE_SERVICE_UUID)?;
    adapter
        .start_scan(ScanFilter {
            services: vec![service_uuid],
        })
        .await
        .map_err(|err| TransportError::Ble(format!("BLE scan failed: {err}")))?;
    tokio::time::sleep(BLE_SCAN_DURATION).await;
    for peripheral in adapter
        .peripherals()
        .await
        .map_err(|err| TransportError::Ble(format!("BLE peripheral query failed: {err}")))?
    {
        let Some(properties) = peripheral
            .properties()
            .await
            .map_err(|err| TransportError::Ble(format!("BLE properties failed: {err}")))?
        else {
            continue;
        };
        if normalize_ble_address(properties.address.to_string())? == target.device_address {
            return Ok((adapter, peripheral));
        }
    }
    Err(TransportError::Ble(format!(
        "BLE device {} was not found on {}",
        target.device_address, target.adapter
    )))
}

fn uuid(value: &str) -> TransportResult<Uuid> {
    Uuid::parse_str(value)
        .map_err(|err| TransportError::Fixture(format!("invalid BLE UUID {value}: {err}")))
}

fn normalize_adapter(adapter: String) -> TransportResult<String> {
    let adapter = adapter.trim();
    if adapter.is_empty() || adapter.contains('/') || adapter.chars().any(char::is_whitespace) {
        return Err(TransportError::Fixture(
            "BLE adapter must be a BlueZ adapter name such as hci0".to_string(),
        ));
    }
    Ok(adapter.to_string())
}

fn normalize_ble_address(address: String) -> TransportResult<String> {
    let address = address.trim().to_ascii_uppercase();
    let parts = address.split(':').collect::<Vec<_>>();
    let valid = parts.len() == 6
        && parts
            .iter()
            .all(|part| part.len() == 2 && part.chars().all(|ch| ch.is_ascii_hexdigit()));
    if !valid {
        return Err(TransportError::Fixture(
            "BLE device address must use AA:BB:CC:DD:EE:FF form".to_string(),
        ));
    }
    Ok(address)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ble_uuids_match_macos_transport_contract() {
        assert_eq!(BLE_SERVICE_UUID, "45C7158E-0C3B-4E90-A847-452A15B14191");
        assert_eq!(BLE_COMMAND_UUID, "46C7158E-0C3B-4E90-A847-452A15B14191");
        assert_eq!(BLE_NOTIFY_UUID, "47C7158E-0C3B-4E90-A847-452A15B14191");
    }

    #[test]
    fn ble_target_normalizes_address_and_builds_descriptor() {
        let target = BleTarget::new("hci0", "aa:bb:cc:dd:ee:ff", "Bench ESP32").unwrap();
        assert_eq!(target.device_address, "AA:BB:CC:DD:EE:FF");
        assert_eq!(target.id(), "ble:hci0:AA:BB:CC:DD:EE:FF");

        let transport = LinuxBleTransport::new(target);
        let descriptor = transport.descriptor();
        assert_eq!(descriptor.id.0, "ble:hci0:AA:BB:CC:DD:EE:FF");
        assert_eq!(descriptor.kind, TransportKind::Ble);
        assert_eq!(descriptor.display_name, "Bench ESP32");
    }

    #[test]
    fn ble_target_rejects_invalid_bluez_identifiers() {
        assert!(BleTarget::new("", "AA:BB:CC:DD:EE:FF", "BLE").is_err());
        assert!(BleTarget::new("hci 0", "AA:BB:CC:DD:EE:FF", "BLE").is_err());
        assert!(BleTarget::new("hci0", "AA:BB", "BLE").is_err());
        assert!(BleTarget::new("hci0", "GG:BB:CC:DD:EE:FF", "BLE").is_err());
    }

    #[tokio::test]
    async fn ble_gatt_connect_reports_missing_adapter_or_device() {
        let mut transport =
            LinuxBleTransport::new(BleTarget::new("hci0", "AA:BB:CC:DD:EE:FF", "BLE").unwrap());
        assert!(matches!(
            transport.connect().await,
            Err(TransportError::Ble(_))
        ));
    }
}
