use crate::{TransportError, TransportResult};

#[derive(Default, Debug)]
pub struct LinuxBleManager;

impl LinuxBleManager {
    pub fn scan(&self) -> TransportResult<Vec<String>> {
        Err(TransportError::NotImplemented(
            "BLE scan/connect via BlueZ D-Bus",
        ))
    }
}
