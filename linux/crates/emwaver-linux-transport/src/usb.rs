use crate::{TransportError, TransportResult};
use emwaver_linux_core::TransportKind;
use rusb::{Context, UsbContext};
use serde::{Deserialize, Serialize};

pub const STM32_VENDOR_ID: u16 = 0x0483;
pub const STM32_RUN_MODE_PRODUCT_ID: u16 = 0x5740;
pub const STM32_DFU_PRODUCT_ID: u16 = 0xdf11;

pub const ESPRESSIF_VENDOR_ID: u16 = 0x303a;
pub const CP210X_VENDOR_ID: u16 = 0x10c4;
pub const CP210X_USB_UART_PRODUCT_ID: u16 = 0xea60;
pub const WCH_VENDOR_ID: u16 = 0x1a86;
pub const WCH_CH9102_PRODUCT_ID: u16 = 0x55d4;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum UsbDeviceRole {
    Stm32RunModeMidi,
    Stm32Dfu,
    Esp32Serial,
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum UsbAccessState {
    Accessible,
    PermissionDenied,
    KernelBusy,
    Unknown(String),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct UsbDeviceCandidate {
    pub id: String,
    pub role: UsbDeviceRole,
    pub transport: TransportKind,
    pub vendor_id: u16,
    pub product_id: u16,
    pub bus_number: u8,
    pub address: u8,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial_number: Option<String>,
    pub access: UsbAccessState,
    pub guidance: Option<String>,
}

impl UsbDeviceCandidate {
    pub fn display_name(&self) -> String {
        self.product
            .clone()
            .unwrap_or_else(|| default_label_for_role(&self.role).to_string())
    }
}

#[derive(Default, Debug)]
pub struct LinuxUsbManager;

impl LinuxUsbManager {
    pub fn discover(&self) -> TransportResult<Vec<UsbDeviceCandidate>> {
        let context = Context::new().map_err(|err| TransportError::Usb(err.to_string()))?;
        let devices = context
            .devices()
            .map_err(|err| TransportError::Usb(err.to_string()))?;
        let mut candidates = Vec::new();

        for device in devices.iter() {
            let descriptor = match device.device_descriptor() {
                Ok(descriptor) => descriptor,
                Err(err) => {
                    candidates.push(UsbDeviceCandidate {
                        id: format!("usb:{}:{}", device.bus_number(), device.address()),
                        role: UsbDeviceRole::Unknown,
                        transport: TransportKind::UsbVendor,
                        vendor_id: 0,
                        product_id: 0,
                        bus_number: device.bus_number(),
                        address: device.address(),
                        manufacturer: None,
                        product: None,
                        serial_number: None,
                        access: UsbAccessState::Unknown(err.to_string()),
                        guidance: Some(permission_guidance()),
                    });
                    continue;
                }
            };

            let role = classify_usb_device(descriptor.vendor_id(), descriptor.product_id());
            if role == UsbDeviceRole::Unknown {
                continue;
            }

            let mut candidate = UsbDeviceCandidate {
                id: format!("usb:{}:{}", device.bus_number(), device.address()),
                transport: transport_for_role(&role),
                role,
                vendor_id: descriptor.vendor_id(),
                product_id: descriptor.product_id(),
                bus_number: device.bus_number(),
                address: device.address(),
                manufacturer: None,
                product: None,
                serial_number: None,
                access: UsbAccessState::Accessible,
                guidance: None,
            };

            match device.open() {
                Ok(handle) => {
                    candidate.manufacturer =
                        handle.read_manufacturer_string_ascii(&descriptor).ok();
                    candidate.product = handle.read_product_string_ascii(&descriptor).ok();
                    candidate.serial_number =
                        handle.read_serial_number_string_ascii(&descriptor).ok();
                }
                Err(rusb::Error::Access) => {
                    candidate.access = UsbAccessState::PermissionDenied;
                    candidate.guidance = Some(permission_guidance());
                }
                Err(rusb::Error::Busy) => {
                    candidate.access = UsbAccessState::KernelBusy;
                    candidate.guidance = Some(kernel_busy_guidance());
                }
                Err(err) => {
                    candidate.access = UsbAccessState::Unknown(err.to_string());
                    candidate.guidance = Some(permission_guidance());
                }
            }

            candidates.push(candidate);
        }

        Ok(candidates)
    }
}

pub fn classify_usb_device(vendor_id: u16, product_id: u16) -> UsbDeviceRole {
    match (vendor_id, product_id) {
        (STM32_VENDOR_ID, STM32_RUN_MODE_PRODUCT_ID) => UsbDeviceRole::Stm32RunModeMidi,
        (STM32_VENDOR_ID, STM32_DFU_PRODUCT_ID) => UsbDeviceRole::Stm32Dfu,
        (ESPRESSIF_VENDOR_ID, _) => UsbDeviceRole::Esp32Serial,
        (CP210X_VENDOR_ID, CP210X_USB_UART_PRODUCT_ID) => UsbDeviceRole::Esp32Serial,
        (WCH_VENDOR_ID, WCH_CH9102_PRODUCT_ID) => UsbDeviceRole::Esp32Serial,
        _ => UsbDeviceRole::Unknown,
    }
}

pub fn transport_for_role(role: &UsbDeviceRole) -> TransportKind {
    match role {
        UsbDeviceRole::Stm32RunModeMidi => TransportKind::UsbMidi,
        UsbDeviceRole::Stm32Dfu => TransportKind::UsbVendor,
        UsbDeviceRole::Esp32Serial => TransportKind::UsbSerial,
        UsbDeviceRole::Unknown => TransportKind::UsbVendor,
    }
}

fn default_label_for_role(role: &UsbDeviceRole) -> &'static str {
    match role {
        UsbDeviceRole::Stm32RunModeMidi => "EMWaver STM32 USB MIDI",
        UsbDeviceRole::Stm32Dfu => "STM32 DFU Bootloader",
        UsbDeviceRole::Esp32Serial => "ESP32 serial adapter",
        UsbDeviceRole::Unknown => "USB device",
    }
}

fn permission_guidance() -> String {
    "Install linux/resources/udev/99-emwaver.rules, reload udev rules, reconnect the board, and log out/in if group permissions changed.".to_string()
}

fn kernel_busy_guidance() -> String {
    "A kernel driver currently owns this interface. The Linux app will detach only for direct flashing/control paths; close other serial/MIDI tools and reconnect the board.".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_stm32_run_and_dfu_modes() {
        assert_eq!(
            classify_usb_device(STM32_VENDOR_ID, STM32_RUN_MODE_PRODUCT_ID),
            UsbDeviceRole::Stm32RunModeMidi
        );
        assert_eq!(
            classify_usb_device(STM32_VENDOR_ID, STM32_DFU_PRODUCT_ID),
            UsbDeviceRole::Stm32Dfu
        );
    }

    #[test]
    fn classifies_common_esp32_serial_adapters() {
        assert_eq!(
            classify_usb_device(ESPRESSIF_VENDOR_ID, 0x1001),
            UsbDeviceRole::Esp32Serial
        );
        assert_eq!(
            classify_usb_device(CP210X_VENDOR_ID, CP210X_USB_UART_PRODUCT_ID),
            UsbDeviceRole::Esp32Serial
        );
        assert_eq!(
            classify_usb_device(WCH_VENDOR_ID, WCH_CH9102_PRODUCT_ID),
            UsbDeviceRole::Esp32Serial
        );
    }

    #[test]
    fn maps_roles_to_transport_kinds() {
        assert_eq!(
            transport_for_role(&UsbDeviceRole::Stm32RunModeMidi),
            TransportKind::UsbMidi
        );
        assert_eq!(
            transport_for_role(&UsbDeviceRole::Stm32Dfu),
            TransportKind::UsbVendor
        );
        assert_eq!(
            transport_for_role(&UsbDeviceRole::Esp32Serial),
            TransportKind::UsbSerial
        );
    }

    #[test]
    fn display_name_falls_back_to_role_label() {
        let candidate = UsbDeviceCandidate {
            id: "usb:1:2".to_string(),
            role: UsbDeviceRole::Stm32RunModeMidi,
            transport: TransportKind::UsbMidi,
            vendor_id: STM32_VENDOR_ID,
            product_id: STM32_RUN_MODE_PRODUCT_ID,
            bus_number: 1,
            address: 2,
            manufacturer: None,
            product: None,
            serial_number: None,
            access: UsbAccessState::Accessible,
            guidance: None,
        };

        assert_eq!(candidate.display_name(), "EMWaver STM32 USB MIDI");
    }
}
