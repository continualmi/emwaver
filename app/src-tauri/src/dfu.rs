use rusb::{Context, DeviceHandle, Direction, Recipient, RequestType, UsbContext};
use std::{thread, time::Duration};

const USB_VENDOR_ID: u16 = 0x0483;
const USB_PRODUCT_ID: u16 = 0xDF11;

const DFU_DNLOAD: u8 = 0x01;
const DFU_UPLOAD: u8 = 0x02;
const DFU_GETSTATUS: u8 = 0x03;
const DFU_CLRSTATUS: u8 = 0x04;

const STATE_DFU_IDLE: u8 = 0x02;
const STATE_DFU_DOWNLOAD_BUSY: u8 = 0x04;
const STATE_DFU_DOWNLOAD_IDLE: u8 = 0x05;
const STATE_DFU_UPLOAD_IDLE: u8 = 0x09;

pub const BLOCK_SIZE: usize = 2048;
const DFU_INTERFACE: u16 = 0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EmbeddedFirmware {
    Ism,
    Gpio,
    Ir,
    Rfid,
}

impl EmbeddedFirmware {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "ism" => Some(Self::Ism),
            "gpio" => Some(Self::Gpio),
            "ir" => Some(Self::Ir),
            "rfid" => Some(Self::Rfid),
            _ => None,
        }
    }

    pub fn bytes(self) -> &'static [u8] {
        match self {
            Self::Ism => include_bytes!("../resources/dfu/ism.dfu"),
            Self::Gpio => include_bytes!("../resources/dfu/gpio.dfu"),
            Self::Ir => include_bytes!("../resources/dfu/ir.dfu"),
            Self::Rfid => include_bytes!("../resources/dfu/rfid.dfu"),
        }
    }
}

pub struct DfuDevice {
    _ctx: Context,
    handle: DeviceHandle<Context>,
}

impl DfuDevice {
    pub fn open() -> Result<Self, String> {
        let ctx = Context::new().map_err(|e| format!("Failed to init USB context: {e}"))?;
        let mut handle = ctx
            .open_device_with_vid_pid(USB_VENDOR_ID, USB_PRODUCT_ID)
            .ok_or_else(|| "No STM32 DFU device found (VID 0x0483, PID 0xDF11)".to_string())?;

        let _ = handle.set_auto_detach_kernel_driver(true);
        handle
            .claim_interface(DFU_INTERFACE as u8)
            .map_err(|e| format!("Failed to claim DFU interface {DFU_INTERFACE}: {e}"))?;

        Ok(Self { _ctx: ctx, handle })
    }

    fn req_type_out() -> u8 {
        rusb::request_type(Direction::Out, RequestType::Class, Recipient::Interface)
    }

    fn req_type_in() -> u8 {
        rusb::request_type(Direction::In, RequestType::Class, Recipient::Interface)
    }

    fn control_out(&mut self, request: u8, value: u16, data: &[u8], timeout_ms: u64) -> Result<usize, String> {
        self.handle
            .write_control(Self::req_type_out(), request, value, DFU_INTERFACE, data, Duration::from_millis(timeout_ms))
            .map(|n| n as usize)
            .map_err(|e| format!("USB control OUT failed (req=0x{request:02x}): {e}"))
    }

    fn control_in(&mut self, request: u8, value: u16, data: &mut [u8], timeout_ms: u64) -> Result<usize, String> {
        self.handle
            .read_control(Self::req_type_in(), request, value, DFU_INTERFACE, data, Duration::from_millis(timeout_ms))
            .map(|n| n as usize)
            .map_err(|e| format!("USB control IN failed (req=0x{request:02x}): {e}"))
    }

    pub fn get_status(&mut self) -> Result<[u8; 6], String> {
        let mut buf = [0u8; 6];
        let n = self.control_in(DFU_GETSTATUS, 0, &mut buf, 500)?;
        if n < 6 {
            return Err(format!("DFU_GETSTATUS returned {n} bytes (expected 6)"));
        }
        Ok(buf)
    }

    pub fn clear_status(&mut self) -> Result<(), String> {
        self.control_out(DFU_CLRSTATUS, 0, &[], 5000)?;
        Ok(())
    }

    pub fn wait_download_idle(&mut self) -> Result<(), String> {
        let start = std::time::Instant::now();
        let timeout = Duration::from_millis(500);

        let mut status = self.get_status()?;
        while !(status[4] == STATE_DFU_IDLE || status[4] == STATE_DFU_DOWNLOAD_IDLE) {
            if start.elapsed() > timeout {
                return Err("Timeout exceeded while waiting for download idle state".to_string());
            }
            self.clear_status()?;
            status = self.get_status()?;
        }
        Ok(())
    }

    pub fn wait_upload_idle(&mut self) -> Result<(), String> {
        let start = std::time::Instant::now();
        let timeout = Duration::from_millis(500);

        let mut status = self.get_status()?;
        while !(status[4] == STATE_DFU_IDLE || status[4] == STATE_DFU_UPLOAD_IDLE) {
            if start.elapsed() > timeout {
                return Err("Timeout exceeded while waiting for upload idle state".to_string());
            }
            self.clear_status()?;
            status = self.get_status()?;
        }
        Ok(())
    }

    fn poll_timeout_ms(status: [u8; 6]) -> u64 {
        let bw_poll_timeout: u32 =
            ((status[3] as u32) << 16) | ((status[2] as u32) << 8) | (status[1] as u32);
        bw_poll_timeout as u64
    }

    pub fn mass_erase(&mut self) -> Result<(), String> {
        self.wait_download_idle()?;

        let command = [0x41u8];
        self.control_out(DFU_DNLOAD, 0, &command, 50)?;

        let status = self.get_status()?;
        if !(status[4] == STATE_DFU_DOWNLOAD_BUSY || status[4] == STATE_DFU_DOWNLOAD_IDLE) {
            return Err("Mass erase failed (device not in dfuDNBUSY/dfuDNLOAD-IDLE)".to_string());
        }

        thread::sleep(Duration::from_millis(Self::poll_timeout_ms(status)));

        let status = self.get_status()?;
        if !(status[4] == STATE_DFU_IDLE || status[4] == STATE_DFU_DOWNLOAD_IDLE) {
            return Err("Mass erase failed (device not in dfuIDLE/dfuDNLOAD-IDLE)".to_string());
        }

        Ok(())
    }

    pub fn set_address_pointer(&mut self, address: u32) -> Result<(), String> {
        self.wait_download_idle()?;

        let buffer = [
            0x21u8,
            (address & 0xFF) as u8,
            ((address >> 8) & 0xFF) as u8,
            ((address >> 16) & 0xFF) as u8,
            ((address >> 24) & 0xFF) as u8,
        ];

        self.control_out(DFU_DNLOAD, 0, &buffer, 50)?;

        let status = self.get_status()?;
        if !(status[4] == STATE_DFU_DOWNLOAD_BUSY || status[4] == STATE_DFU_DOWNLOAD_IDLE) {
            return Err("Set address pointer failed (device not in dfuDNBUSY/dfuDNLOAD-IDLE)".to_string());
        }

        thread::sleep(Duration::from_millis(Self::poll_timeout_ms(status)));

        let status = self.get_status()?;
        if !(status[4] == STATE_DFU_IDLE || status[4] == STATE_DFU_DOWNLOAD_IDLE) {
            return Err("Set address pointer failed (device not in dfuIDLE/dfuDNLOAD-IDLE)".to_string());
        }

        Ok(())
    }

    pub fn write_block(&mut self, block_num: u16, data: &[u8]) -> Result<(), String> {
        self.wait_download_idle()?;
        self.control_out(DFU_DNLOAD, block_num, data, 500)?;

        let status = self.get_status()?;
        if !(status[4] == STATE_DFU_DOWNLOAD_BUSY || status[4] == STATE_DFU_DOWNLOAD_IDLE) {
            return Err(format!("Write block {block_num} failed (device not in dfuDNBUSY/dfuDNLOAD-IDLE)"));
        }

        thread::sleep(Duration::from_millis(Self::poll_timeout_ms(status)));

        let status = self.get_status()?;
        if !(status[4] == STATE_DFU_IDLE || status[4] == STATE_DFU_DOWNLOAD_IDLE) {
            return Err(format!("Write block {block_num} failed (device not in dfuIDLE/dfuDNLOAD-IDLE)"));
        }

        Ok(())
    }

    pub fn read_block(&mut self, block_num: u16, out: &mut [u8]) -> Result<usize, String> {
        self.control_in(DFU_UPLOAD, block_num, out, 500)
    }

    pub fn flash(&mut self, firmware: &[u8], mut on_progress: impl FnMut(String)) -> Result<(), String> {
        on_progress("Starting mass erase...".to_string());
        self.mass_erase()?;
        on_progress("Mass erase complete. Setting address pointer...".to_string());
        self.set_address_pointer(0x0800_0000)?;
        on_progress("Address pointer set. Starting flash write...".to_string());

        let mut block_num: u16 = 2;
        let mut read_buffer = vec![0u8; BLOCK_SIZE];
        for chunk in firmware.chunks(BLOCK_SIZE) {
            on_progress(format!("Writing block {block_num}..."));
            self.write_block(block_num, chunk)?;

            on_progress(format!("Verifying block {block_num}..."));
            self.wait_upload_idle()?;

            let buf = &mut read_buffer[..chunk.len()];
            let n = self.read_block(block_num, buf)?;
            if n != chunk.len() {
                return Err(format!(
                    "Verification failed for block {block_num}: read {n} bytes, expected {}",
                    chunk.len()
                ));
            }
            if buf != chunk {
                return Err(format!("Error verifying block {}", block_num.saturating_sub(2)));
            }

            block_num = block_num.wrapping_add(1);
        }

        on_progress("Flash write completed successfully.".to_string());
        Ok(())
    }
}
