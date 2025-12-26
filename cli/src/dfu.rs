use rusb::{Context, DeviceHandle, Direction, Recipient, RequestType, UsbContext};
use std::{thread, time::Duration};

pub const DEFAULT_USB_VENDOR_ID: u16 = 0x0483;
pub const DEFAULT_USB_PRODUCT_ID: u16 = 0xDF11;

const STATUS_OK: u8 = 0x00;

const DFU_DNLOAD: u8 = 0x01;
const DFU_UPLOAD: u8 = 0x02;
const DFU_GETSTATUS: u8 = 0x03;
const DFU_CLRSTATUS: u8 = 0x04;

const STATE_DFU_IDLE: u8 = 0x02;
const STATE_DFU_DNLOAD_SYNC: u8 = 0x03;
const STATE_DFU_DOWNLOAD_BUSY: u8 = 0x04;
const STATE_DFU_DOWNLOAD_IDLE: u8 = 0x05;
const STATE_DFU_MANIFEST_SYNC: u8 = 0x06;
const STATE_DFU_MANIFEST: u8 = 0x07;
const STATE_DFU_MANIFEST_WAIT_RESET: u8 = 0x08;
const STATE_DFU_UPLOAD_IDLE: u8 = 0x09;
const STATE_DFU_ERROR: u8 = 0x0A;

pub const BLOCK_SIZE: usize = 2048;
const DFU_INTERFACE: u16 = 0;

pub struct DfuDevice {
    _ctx: Context,
    handle: DeviceHandle<Context>,
}

impl DfuDevice {
    pub fn open(vendor_id: u16, product_id: u16) -> Result<Self, String> {
        let ctx = Context::new().map_err(|e| format!("Failed to init USB context: {e}"))?;
        let handle = ctx
            .open_device_with_vid_pid(vendor_id, product_id)
            .ok_or_else(|| format!("No DFU device found (VID 0x{vendor_id:04x}, PID 0x{product_id:04x})"))?;

        let mut device = Self { _ctx: ctx, handle };

        let _ = device.handle.set_auto_detach_kernel_driver(true);
        let _ = device.handle.set_active_configuration(1);
        let _ = device
            .handle
            .set_alternate_setting(DFU_INTERFACE as u8, 0);

        device
            .handle
            .claim_interface(DFU_INTERFACE as u8)
            .map_err(|e| format!("Failed to claim DFU interface {DFU_INTERFACE}: {e}"))?;

        // Some DFU implementations can start in dfuERROR; clear it up-front.
        if let Ok(status) = device.get_status() {
            if status[4] == STATE_DFU_ERROR {
                let _ = device.clear_status();
            }
        }

        Ok(device)
    }

    fn req_type_out() -> u8 {
        rusb::request_type(Direction::Out, RequestType::Class, Recipient::Interface)
    }

    fn req_type_in() -> u8 {
        rusb::request_type(Direction::In, RequestType::Class, Recipient::Interface)
    }

    fn control_out(
        &mut self,
        request: u8,
        value: u16,
        data: &[u8],
        timeout_ms: u64,
    ) -> Result<usize, String> {
        self.handle
            .write_control(
                Self::req_type_out(),
                request,
                value,
                DFU_INTERFACE,
                data,
                Duration::from_millis(timeout_ms),
            )
            .map(|n| n as usize)
            .map_err(|e| format!("USB control OUT failed (req=0x{request:02x}): {e}"))
    }

    fn control_in(
        &mut self,
        request: u8,
        value: u16,
        data: &mut [u8],
        timeout_ms: u64,
    ) -> Result<usize, String> {
        self.handle
            .read_control(
                Self::req_type_in(),
                request,
                value,
                DFU_INTERFACE,
                data,
                Duration::from_millis(timeout_ms),
            )
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
        let timeout = Duration::from_secs(5);

        let mut status = self.get_status()?;
        while !(status[4] == STATE_DFU_IDLE || status[4] == STATE_DFU_DOWNLOAD_IDLE) {
            if start.elapsed() > timeout {
                return Err(format!(
                    "Timeout exceeded while waiting for download idle state (status={})",
                    format_status(status)
                ));
            }
            self.clear_status()?;
            status = self.get_status()?;
        }
        Ok(())
    }

    pub fn wait_upload_idle(&mut self) -> Result<(), String> {
        let start = std::time::Instant::now();
        let timeout = Duration::from_secs(5);

        let mut status = self.get_status()?;
        while !(status[4] == STATE_DFU_IDLE || status[4] == STATE_DFU_UPLOAD_IDLE) {
            if start.elapsed() > timeout {
                return Err(format!(
                    "Timeout exceeded while waiting for upload idle state (status={})",
                    format_status(status)
                ));
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

        let start = std::time::Instant::now();
        let timeout = Duration::from_secs(60);

        loop {
            let status = self.get_status()?;
            if status[0] != STATUS_OK || status[4] == STATE_DFU_ERROR {
                return Err(format!("Mass erase failed (status={})", format_status(status)));
            }

            match status[4] {
                STATE_DFU_IDLE | STATE_DFU_DOWNLOAD_IDLE => break,
                STATE_DFU_DNLOAD_SYNC
                | STATE_DFU_DOWNLOAD_BUSY
                | STATE_DFU_MANIFEST_SYNC
                | STATE_DFU_MANIFEST
                | STATE_DFU_MANIFEST_WAIT_RESET => {
                    if start.elapsed() > timeout {
                        return Err(format!(
                            "Timeout exceeded while waiting for mass erase (status={})",
                            format_status(status)
                        ));
                    }
                    thread::sleep(Duration::from_millis(Self::poll_timeout_ms(status).max(10)));
                }
                other => {
                    return Err(format!(
                        "Mass erase failed (unexpected DFU state 0x{other:02x}, status={})",
                        format_status(status)
                    ));
                }
            }
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

        let start = std::time::Instant::now();
        let timeout = Duration::from_secs(5);

        loop {
            let status = self.get_status()?;
            if status[0] != STATUS_OK || status[4] == STATE_DFU_ERROR {
                return Err(format!(
                    "Set address pointer failed (status={})",
                    format_status(status)
                ));
            }
            match status[4] {
                STATE_DFU_IDLE | STATE_DFU_DOWNLOAD_IDLE => break,
                STATE_DFU_DNLOAD_SYNC | STATE_DFU_DOWNLOAD_BUSY => {
                    if start.elapsed() > timeout {
                        return Err(format!(
                            "Timeout exceeded while setting address pointer (status={})",
                            format_status(status)
                        ));
                    }
                    thread::sleep(Duration::from_millis(Self::poll_timeout_ms(status).max(10)));
                }
                other => {
                    return Err(format!(
                        "Set address pointer failed (unexpected DFU state 0x{other:02x}, status={})",
                        format_status(status)
                    ));
                }
            }
        }

        Ok(())
    }

    pub fn write_block(&mut self, block_num: u16, data: &[u8]) -> Result<(), String> {
        self.wait_download_idle()?;
        self.control_out(DFU_DNLOAD, block_num, data, 500)?;

        let start = std::time::Instant::now();
        let timeout = Duration::from_secs(5);

        loop {
            let status = self.get_status()?;
            if status[0] != STATUS_OK || status[4] == STATE_DFU_ERROR {
                return Err(format!(
                    "Write block {block_num} failed (status={})",
                    format_status(status)
                ));
            }
            match status[4] {
                STATE_DFU_IDLE | STATE_DFU_DOWNLOAD_IDLE => break,
                STATE_DFU_DNLOAD_SYNC | STATE_DFU_DOWNLOAD_BUSY => {
                    if start.elapsed() > timeout {
                        return Err(format!(
                            "Timeout exceeded while writing block {block_num} (status={})",
                            format_status(status)
                        ));
                    }
                    thread::sleep(Duration::from_millis(Self::poll_timeout_ms(status).max(10)));
                }
                other => {
                    return Err(format!(
                        "Write block {block_num} failed (unexpected DFU state 0x{other:02x}, status={})",
                        format_status(status)
                    ));
                }
            }
        }

        Ok(())
    }

    pub fn read_block(&mut self, block_num: u16, out: &mut [u8]) -> Result<usize, String> {
        self.control_in(DFU_UPLOAD, block_num, out, 500)
    }

    pub fn flash(
        &mut self,
        firmware: &[u8],
        address: u32,
        mut on_progress: impl FnMut(String),
    ) -> Result<(), String> {
        let _ = self.clear_status();
        on_progress("Starting mass erase...".to_string());
        self.mass_erase()?;
        on_progress("Mass erase complete. Setting address pointer...".to_string());
        self.set_address_pointer(address)?;
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

fn format_status(status: [u8; 6]) -> String {
    let poll = DfuDevice::poll_timeout_ms(status);
    format!(
        "bStatus=0x{status:02x} bState=0x{state:02x} bwPollTimeout={poll} iString={istring}",
        status = status[0],
        state = status[4],
        poll = poll,
        istring = status[5]
    )
}
