use crate::{TransportError, TransportResult};

#[derive(Default, Debug)]
pub struct LinuxUsbManager;

impl LinuxUsbManager {
    pub fn discover(&self) -> TransportResult<Vec<String>> {
        Err(TransportError::NotImplemented(
            "USB discovery via ALSA/libusb/udev",
        ))
    }
}
