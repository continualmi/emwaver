use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
pub enum TransportKind {
    UsbMidi,
    UsbSerial,
    UsbVendor,
    Ble,
    Wifi,
    Simulator,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DeviceRecord {
    pub id: String,
    pub display_name: String,
    pub transport: TransportKind,
    pub hardware_uid: Option<String>,
    pub firmware_version: Option<String>,
    pub connected: bool,
    pub busy: bool,
}

impl DeviceRecord {
    pub fn new(
        id: impl Into<String>,
        display_name: impl Into<String>,
        transport: TransportKind,
        hardware_uid: Option<String>,
    ) -> Self {
        Self {
            id: id.into(),
            display_name: display_name.into(),
            transport,
            hardware_uid,
            firmware_version: None,
            connected: false,
            busy: false,
        }
    }

    pub fn identity_key(&self) -> String {
        self.hardware_uid
            .as_ref()
            .map(|uid| format!("uid:{uid}"))
            .unwrap_or_else(|| format!("transport:{}:{:?}", self.id, self.transport))
    }
}

#[derive(Default, Debug)]
pub struct DeviceRegistry {
    devices: BTreeMap<String, DeviceRecord>,
}

impl DeviceRegistry {
    pub fn upsert(&mut self, mut record: DeviceRecord) -> String {
        let key = record.identity_key();
        if let Some(existing) = self.devices.get_mut(&key) {
            record.busy = existing.busy;
            *existing = record;
        } else {
            self.devices.insert(key.clone(), record);
        }
        key
    }

    pub fn set_busy_by_uid(&mut self, hardware_uid: &str, busy: bool) {
        let key = format!("uid:{hardware_uid}");
        if let Some(record) = self.devices.get_mut(&key) {
            record.busy = busy;
        }
    }

    pub fn get(&self, key: &str) -> Option<&DeviceRecord> {
        self.devices.get(key)
    }

    pub fn list(&self) -> Vec<DeviceRecord> {
        self.devices.values().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_deduplicates_transports_with_same_uid() {
        let mut registry = DeviceRegistry::default();
        let usb_key = registry.upsert(DeviceRecord::new(
            "usb-1",
            "USB board",
            TransportKind::UsbMidi,
            Some("ABCDEF".to_string()),
        ));
        let ble_key = registry.upsert(DeviceRecord::new(
            "ble-1",
            "BLE board",
            TransportKind::Ble,
            Some("ABCDEF".to_string()),
        ));

        assert_eq!(usb_key, ble_key);
        assert_eq!(registry.list().len(), 1);
        assert_eq!(
            registry.get(&usb_key).unwrap().transport,
            TransportKind::Ble
        );
    }
}
