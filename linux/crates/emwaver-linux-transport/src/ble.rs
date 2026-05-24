use crate::{
    EmwFrame, EmwaverTransport, TransportDescriptor, TransportError, TransportId, TransportResult,
};
use async_trait::async_trait;
use emwaver_linux_core::TransportKind;

pub const BLE_SERVICE_UUID: &str = "45C7158E-0C3B-4E90-A847-452A15B14191";
pub const BLE_COMMAND_UUID: &str = "46C7158E-0C3B-4E90-A847-452A15B14191";
pub const BLE_NOTIFY_UUID: &str = "47C7158E-0C3B-4E90-A847-452A15B14191";

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
        Err(TransportError::NotImplemented(
            "BLE scan/connect via BlueZ D-Bus",
        ))
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

#[derive(Debug)]
pub struct LinuxBleTransport {
    target: BleTarget,
}

impl LinuxBleTransport {
    pub fn new(target: BleTarget) -> Self {
        Self { target }
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
        Err(TransportError::NotImplemented(
            "BLE GATT connect via BlueZ D-Bus",
        ))
    }

    async fn send_frame(&mut self, _frame: EmwFrame) -> TransportResult<()> {
        Err(TransportError::NotConnected)
    }

    async fn next_frame(&mut self) -> TransportResult<EmwFrame> {
        Err(TransportError::NotConnected)
    }

    async fn close(&mut self) -> TransportResult<()> {
        Ok(())
    }
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
    async fn ble_gatt_connect_is_explicitly_pending() {
        let mut transport =
            LinuxBleTransport::new(BleTarget::new("hci0", "AA:BB:CC:DD:EE:FF", "BLE").unwrap());
        assert!(matches!(
            transport.connect().await,
            Err(TransportError::NotImplemented(_))
        ));
    }
}
