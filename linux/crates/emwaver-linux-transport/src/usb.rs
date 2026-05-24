use crate::command;
use crate::usb_midi_sysex::{
    decode_usb_midi_to_superframe, encode_superframe_to_usb_midi, LANE_SIZE_BYTES,
    SUPERFRAME_SIZE_BYTES, USB_MIDI_PACKET_SIZE_BYTES,
};
use crate::{
    EmwFrame, EmwaverTransport, TransportDescriptor, TransportError, TransportId, TransportResult,
};
use async_trait::async_trait;
use emwaver_linux_core::TransportKind;
use rusb::{Context, DeviceHandle, UsbContext};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;

pub const STM32_VENDOR_ID: u16 = 0x0483;
pub const STM32_RUN_MODE_PRODUCT_ID: u16 = 0x5740;
pub const STM32_DFU_PRODUCT_ID: u16 = 0xdf11;

pub const ESPRESSIF_VENDOR_ID: u16 = 0x303a;
pub const CP210X_VENDOR_ID: u16 = 0x10c4;
pub const CP210X_USB_UART_PRODUCT_ID: u16 = 0xea60;
pub const WCH_VENDOR_ID: u16 = 0x1a86;
pub const WCH_CH9102_PRODUCT_ID: u16 = 0x55d4;

pub const USB_MIDI_INTERFACE_NUMBER: u8 = 1;
pub const USB_MIDI_OUT_ENDPOINT: u8 = 0x01;
pub const USB_MIDI_IN_ENDPOINT: u8 = 0x81;
const USB_MIDI_IO_TIMEOUT: Duration = Duration::from_millis(600);

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

    pub async fn probe_run_mode_candidate(
        &self,
        candidate: UsbDeviceCandidate,
    ) -> TransportResult<command::DeviceProbe> {
        let mut transport = LinuxUsbMidiTransport::new(candidate)?;
        transport.connect().await?;
        let probe = command::probe_device(&mut transport).await;
        let _ = transport.close().await;
        Ok(probe)
    }
}

#[derive(Debug)]
pub struct LinuxUsbMidiTransport {
    candidate: UsbDeviceCandidate,
    context: Option<Context>,
    handle: Option<Mutex<DeviceHandle<Context>>>,
}

impl LinuxUsbMidiTransport {
    pub fn new(candidate: UsbDeviceCandidate) -> TransportResult<Self> {
        if candidate.role != UsbDeviceRole::Stm32RunModeMidi {
            return Err(TransportError::Usb(format!(
                "USB MIDI transport requires STM32 run-mode candidate, got {:?}",
                candidate.role
            )));
        }

        Ok(Self {
            candidate,
            context: None,
            handle: None,
        })
    }

    pub fn command_lane_superframe(command_lane: &[u8]) -> TransportResult<EmwFrame> {
        if command_lane.len() > LANE_SIZE_BYTES {
            return Err(TransportError::Usb(format!(
                "command lane is {} bytes; expected at most {LANE_SIZE_BYTES}",
                command_lane.len()
            )));
        }

        let mut superframe = [0u8; SUPERFRAME_SIZE_BYTES];
        superframe[..command_lane.len()].copy_from_slice(command_lane);
        Ok(EmwFrame {
            bytes: superframe.to_vec(),
        })
    }

    fn open_matching_handle(&self) -> TransportResult<(Context, DeviceHandle<Context>)> {
        let context = Context::new().map_err(|err| TransportError::Usb(err.to_string()))?;
        let devices = context
            .devices()
            .map_err(|err| TransportError::Usb(err.to_string()))?;

        for device in devices.iter() {
            if device.bus_number() != self.candidate.bus_number
                || device.address() != self.candidate.address
            {
                continue;
            }

            let descriptor = device
                .device_descriptor()
                .map_err(|err| TransportError::Usb(err.to_string()))?;
            if descriptor.vendor_id() != self.candidate.vendor_id
                || descriptor.product_id() != self.candidate.product_id
            {
                continue;
            }

            let handle = device
                .open()
                .map_err(|err| usb_open_error(err, &self.candidate))?;
            return Ok((context, handle));
        }

        Err(TransportError::Usb(format!(
            "USB device {} is no longer present",
            self.candidate.id
        )))
    }
}

#[async_trait]
impl EmwaverTransport for LinuxUsbMidiTransport {
    fn descriptor(&self) -> TransportDescriptor {
        TransportDescriptor {
            id: TransportId(self.candidate.id.clone()),
            kind: TransportKind::UsbMidi,
            display_name: self.candidate.display_name(),
            hardware_uid: None,
            firmware_version: None,
        }
    }

    async fn connect(&mut self) -> TransportResult<()> {
        let (context, handle) = self.open_matching_handle()?;
        let _ = handle.set_auto_detach_kernel_driver(true);

        match handle.claim_interface(USB_MIDI_INTERFACE_NUMBER) {
            Ok(()) => {}
            Err(original) => {
                let _ = handle.set_active_configuration(1);
                handle
                    .claim_interface(USB_MIDI_INTERFACE_NUMBER)
                    .map_err(|err| {
                        TransportError::Usb(format!(
                            "failed to claim USB MIDI interface {USB_MIDI_INTERFACE_NUMBER}: {err}; original error: {original}. {}",
                            kernel_busy_guidance()
                        ))
                    })?;
            }
        }

        self.context = Some(context);
        self.handle = Some(Mutex::new(handle));
        Ok(())
    }

    async fn send_frame(&mut self, frame: EmwFrame) -> TransportResult<()> {
        let packet = encode_superframe_to_usb_midi(&frame.bytes)
            .map_err(|err| TransportError::Usb(err.to_string()))?;
        let handle = self.handle.as_ref().ok_or(TransportError::NotConnected)?;
        let written = handle
            .lock()
            .map_err(|_| TransportError::Usb("USB MIDI handle lock poisoned".to_string()))?
            .write_bulk(USB_MIDI_OUT_ENDPOINT, &packet, USB_MIDI_IO_TIMEOUT)
            .map_err(|err| TransportError::Usb(format!("USB MIDI write failed: {err}")))?;

        if written != USB_MIDI_PACKET_SIZE_BYTES {
            return Err(TransportError::Usb(format!(
                "USB MIDI write sent {written} bytes; expected {USB_MIDI_PACKET_SIZE_BYTES}"
            )));
        }
        Ok(())
    }

    async fn next_frame(&mut self) -> TransportResult<EmwFrame> {
        let handle = self.handle.as_ref().ok_or(TransportError::NotConnected)?;
        let mut packet = [0u8; USB_MIDI_PACKET_SIZE_BYTES];
        let read = handle
            .lock()
            .map_err(|_| TransportError::Usb("USB MIDI handle lock poisoned".to_string()))?
            .read_bulk(USB_MIDI_IN_ENDPOINT, &mut packet, USB_MIDI_IO_TIMEOUT)
            .map_err(|err| TransportError::Usb(format!("USB MIDI read failed: {err}")))?;

        if read != USB_MIDI_PACKET_SIZE_BYTES {
            return Err(TransportError::Usb(format!(
                "USB MIDI read returned {read} bytes; expected {USB_MIDI_PACKET_SIZE_BYTES}"
            )));
        }

        let superframe = decode_usb_midi_to_superframe(&packet)
            .map_err(|err| TransportError::Usb(err.to_string()))?;
        Ok(EmwFrame {
            bytes: superframe.to_vec(),
        })
    }

    async fn close(&mut self) -> TransportResult<()> {
        if let Some(handle) = self.handle.take() {
            let _ = handle
                .lock()
                .map_err(|_| TransportError::Usb("USB MIDI handle lock poisoned".to_string()))?
                .release_interface(USB_MIDI_INTERFACE_NUMBER);
        }
        self.context = None;
        Ok(())
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

fn usb_open_error(err: rusb::Error, candidate: &UsbDeviceCandidate) -> TransportError {
    match err {
        rusb::Error::Access => TransportError::Usb(format!(
            "permission denied opening {}. {}",
            candidate.id,
            permission_guidance()
        )),
        rusb::Error::Busy => TransportError::Usb(format!(
            "USB interface for {} is busy. {}",
            candidate.id,
            kernel_busy_guidance()
        )),
        err => TransportError::Usb(format!("failed to open {}: {err}", candidate.id)),
    }
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

    #[test]
    fn command_lane_superframe_pads_to_fixed_size() {
        let frame = LinuxUsbMidiTransport::command_lane_superframe(&[0x08]).unwrap();
        assert_eq!(frame.bytes.len(), SUPERFRAME_SIZE_BYTES);
        assert_eq!(frame.bytes[0], 0x08);
        assert!(frame.bytes[1..].iter().all(|byte| *byte == 0));
    }

    #[test]
    fn command_lane_superframe_rejects_oversized_commands() {
        let command = [0xaa; LANE_SIZE_BYTES + 1];
        assert!(LinuxUsbMidiTransport::command_lane_superframe(&command).is_err());
    }
}
