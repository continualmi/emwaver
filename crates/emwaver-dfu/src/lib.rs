/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

use rusb::{Context, DeviceHandle, Direction, Recipient, RequestType, UsbContext};
use std::{thread, time::Duration};

pub const DEFAULT_USB_VENDOR_ID: u16 = 0x0483;
pub const DEFAULT_USB_PRODUCT_ID: u16 = 0xDF11;

const STATUS_OK: u8 = 0x00;

const DFU_DNLOAD: u8 = 0x01;
const DFU_UPLOAD: u8 = 0x02;
const DFU_GETSTATUS: u8 = 0x03;
const DFU_CLRSTATUS: u8 = 0x04;
const DFU_ABORT: u8 = 0x06;

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

#[derive(Clone, Debug)]
pub struct DfuAltSettingInfo {
    pub setting_number: u8,
    pub description: Option<String>,
}

#[derive(Clone, Debug)]
pub struct DfuDiscoveryInfo {
    pub interface_number: u8,
    pub alt_settings: Vec<DfuAltSettingInfo>,
    pub selected_alt_setting: Option<u8>,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct DfuOpenOptions {
    pub alt_setting: Option<u8>,
    pub verbose: bool,
}

pub struct DfuDevice {
    _ctx: Context,
    handle: DeviceHandle<Context>,
    interface: u16,
}

impl DfuDevice {
    #[allow(dead_code)]
    pub fn open(vendor_id: u16, product_id: u16) -> Result<Self, String> {
        Ok(Self::open_with_options(vendor_id, product_id, DfuOpenOptions::default())?.0)
    }

    pub fn open_with_options(
        vendor_id: u16,
        product_id: u16,
        options: DfuOpenOptions,
    ) -> Result<(Self, DfuDiscoveryInfo), String> {
        let ctx = Context::new().map_err(|e| format!("Failed to init USB context: {e}"))?;
        let handle = ctx
            .open_device_with_vid_pid(vendor_id, product_id)
            .ok_or_else(|| {
                format!("No DFU device found (VID 0x{vendor_id:04x}, PID 0x{product_id:04x})")
            })?;

        let mut device = Self {
            _ctx: ctx,
            handle,
            interface: 0,
        };

        let _ = device.handle.set_auto_detach_kernel_driver(true);

        let mut discovery =
            discover_dfu_interface(&mut device, options.verbose).unwrap_or_else(|err| {
                if options.verbose {
                    eprintln!("DFU discovery failed; falling back to interface 0: {err}");
                }
                DfuDiscoveryInfo {
                    interface_number: 0,
                    alt_settings: Vec::new(),
                    selected_alt_setting: None,
                }
            });

        device.interface = discovery.interface_number as u16;

        // Keep the USB open path aligned with the Android/Desktop implementations:
        // claim the DFU interface directly, only attempting to set a configuration if needed.
        match device.handle.claim_interface(discovery.interface_number) {
            Ok(()) => {}
            Err(original) => {
                let _ = device.handle.set_active_configuration(1);
                device.handle.claim_interface(discovery.interface_number).map_err(|e| {
                    format!(
                        "Failed to claim DFU interface {}: {e} (after set_active_configuration; original error: {original})",
                        discovery.interface_number
                    )
                })?;
            }
        }

        let selected_alt = if let Some(alt) = options.alt_setting {
            Some(alt)
        } else {
            discovery
                .alt_settings
                .iter()
                .find(|alt| {
                    alt.description
                        .as_deref()
                        .is_some_and(|s| s.to_ascii_lowercase().contains("internal flash"))
                })
                .map(|alt| alt.setting_number)
        };

        if let Some(alt) = selected_alt {
            match device
                .handle
                .set_alternate_setting(discovery.interface_number, alt)
            {
                Ok(()) => {
                    discovery.selected_alt_setting = Some(alt);
                    if options.verbose {
                        eprintln!(
                            "Using DFU alt setting {alt} on interface {}",
                            discovery.interface_number
                        );
                    }
                }
                Err(err) => {
                    if options.verbose {
                        eprintln!(
                            "Failed to set DFU alt setting {alt} on interface {}: {err}",
                            discovery.interface_number
                        );
                    }
                }
            }
        }

        // Some DFU implementations can start in dfuERROR; clear it up-front.
        if let Ok(status) = device.get_status() {
            if status[4] == STATE_DFU_ERROR {
                let _ = device.clear_status();
            }
        }

        Ok((device, discovery))
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
                self.interface,
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
                self.interface,
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

    pub fn abort(&mut self) -> Result<(), String> {
        let _ = self.control_out(DFU_ABORT, 0, &[], 500);
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
        match self.mass_erase_once() {
            Ok(()) => Ok(()),
            Err(err) => {
                // Best-effort recovery: attempt to abort/clear any stuck operation once, then retry.
                let _ = self.abort();
                let _ = self.clear_status();
                let _ = self.wait_download_idle();
                self.mass_erase_once()
                    .map_err(|retry| format!("{err}; retry failed: {retry}"))
            }
        }
    }

    fn mass_erase_once(&mut self) -> Result<(), String> {
        self.wait_download_idle()?;

        let command = [0x41u8];
        self.control_out(DFU_DNLOAD, 0, &command, 50)?;

        let start = std::time::Instant::now();
        let timeout = Duration::from_secs(60);

        loop {
            let status = self.get_status()?;
            if status[0] != STATUS_OK || status[4] == STATE_DFU_ERROR {
                return Err(format!(
                    "Mass erase failed (status={})",
                    format_status(status)
                ));
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
                    let remaining = timeout
                        .checked_sub(start.elapsed())
                        .unwrap_or(Duration::from_millis(0));
                    let sleep_ms = Self::poll_timeout_ms(status).max(10);
                    thread::sleep(Duration::from_millis(sleep_ms).min(remaining));
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
                    let remaining = timeout
                        .checked_sub(start.elapsed())
                        .unwrap_or(Duration::from_millis(0));
                    let sleep_ms = Self::poll_timeout_ms(status).max(10);
                    thread::sleep(Duration::from_millis(sleep_ms).min(remaining));
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
                    let remaining = timeout
                        .checked_sub(start.elapsed())
                        .unwrap_or(Duration::from_millis(0));
                    let sleep_ms = Self::poll_timeout_ms(status).max(10);
                    thread::sleep(Duration::from_millis(sleep_ms).min(remaining));
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
        // DFU_UPLOAD can stall on some host stacks (macOS/libusb often reports this as Pipe error).
        // Add a small retry loop with state recovery.
        let mut last_err: Option<String> = None;
        for attempt in 0..3 {
            if attempt > 0 {
                // Best-effort recovery between attempts.
                let _ = self.abort();
                let _ = self.clear_status();
                let _ = self.wait_upload_idle();
                thread::sleep(Duration::from_millis(20));
            }

            match self.control_in(DFU_UPLOAD, block_num, out, 1500) {
                Ok(n) => return Ok(n),
                Err(e) => {
                    last_err = Some(e);
                }
            }
        }
        Err(last_err.unwrap_or_else(|| "DFU_UPLOAD failed".to_string()))
    }

    pub fn flash(
        &mut self,
        firmware: &[u8],
        address: u32,
        verify: bool,
        mut on_progress: impl FnMut(String),
    ) -> Result<(), String> {
        let _ = self.clear_status();
        let total_blocks = firmware
            .len()
            .div_ceil(BLOCK_SIZE)
            .try_into()
            .unwrap_or(u32::MAX);
        let total_steps = total_blocks.saturating_mul(2).saturating_add(2).max(1);
        let mut step_index: u32 = 0;
        let mut emit = |step: u32, message: String| {
            let pct = (step.saturating_mul(100) / total_steps).min(100);
            on_progress(format!("{message} ({pct}%)"));
        };

        emit(step_index, "Starting mass erase...".to_string());
        self.mass_erase()?;
        step_index = step_index.saturating_add(1);
        emit(
            step_index,
            "Mass erase complete. Setting address pointer...".to_string(),
        );
        self.set_address_pointer(address)?;
        step_index = step_index.saturating_add(1);
        emit(
            step_index,
            "Address pointer set. Starting flash write...".to_string(),
        );

        let mut block_num: u16 = 2;
        let mut read_buffer = vec![0u8; BLOCK_SIZE];
        let mut can_verify = verify;

        for (block_index, chunk) in firmware.chunks(BLOCK_SIZE).enumerate() {
            let block_index = (block_index as u32).saturating_add(1);
            emit(
                step_index,
                format!("Writing block {block_num} ({block_index}/{total_blocks})..."),
            );
            self.write_block(block_num, chunk)?;

            step_index = step_index.saturating_add(1);

            if can_verify {
                emit(
                    step_index,
                    format!("Verifying block {block_num} ({block_index}/{total_blocks})..."),
                );
                self.wait_upload_idle()?;

                let buf = &mut read_buffer[..chunk.len()];
                match self.read_block(block_num, buf) {
                    Ok(n) => {
                        if n != chunk.len() {
                            return Err(format!(
                                "Verification failed for block {block_num}: read {n} bytes, expected {}",
                                chunk.len()
                            ));
                        }
                        if buf != chunk {
                            return Err(format!(
                                "Error verifying block {}",
                                block_num.saturating_sub(2)
                            ));
                        }
                    }
                    Err(e) => {
                        // Some DFU implementations (or macOS USB stacks) will stall DFU_UPLOAD.
                        // If we can't verify, continue flashing without verification rather than failing.
                        let lower = e.to_ascii_lowercase();
                        let looks_like_pipe = lower.contains("pipe error")
                            || lower.contains("stall")
                            || lower.contains("req=0x02");
                        if looks_like_pipe {
                            can_verify = false;
                            emit(
                                step_index,
                                format!(
                                    "Verify not supported ({}). Continuing without verification...",
                                    e
                                ),
                            );
                        } else {
                            return Err(e);
                        }
                    }
                }
            } else {
                emit(step_index, "Skipping verify (unsupported).".to_string());
            }

            step_index = step_index.saturating_add(1);
            block_num = block_num.wrapping_add(1);
        }

        emit(
            total_steps,
            "Flash write completed successfully.".to_string(),
        );
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

fn discover_dfu_interface(
    device: &mut DfuDevice,
    verbose: bool,
) -> Result<DfuDiscoveryInfo, String> {
    let dev = device.handle.device();
    let config = dev
        .active_config_descriptor()
        .or_else(|_| dev.config_descriptor(0))
        .map_err(|e| format!("Failed to read USB config descriptor: {e}"))?;

    for interface in config.interfaces() {
        let descriptors: Vec<_> = interface.descriptors().collect();
        let is_dfu_interface = descriptors
            .iter()
            .any(|d| d.class_code() == 0xFE && d.sub_class_code() == 0x01);
        if !is_dfu_interface {
            continue;
        }

        let interface_number = descriptors
            .first()
            .map(|d| d.interface_number())
            .unwrap_or(0);

        let mut alt_settings = Vec::new();
        for desc in descriptors {
            let description = desc
                .description_string_index()
                .and_then(|index| device.handle.read_string_descriptor_ascii(index).ok());
            alt_settings.push(DfuAltSettingInfo {
                setting_number: desc.setting_number(),
                description,
            });
        }

        if verbose {
            eprintln!("DFU interface: {interface_number}");
            if alt_settings.is_empty() {
                eprintln!("DFU alt settings: <none>");
            } else {
                eprintln!("DFU alt settings:");
                for alt in &alt_settings {
                    match alt.description.as_deref() {
                        Some(d) => eprintln!("  - {}: {d}", alt.setting_number),
                        None => eprintln!("  - {}", alt.setting_number),
                    }
                }
            }
        }

        return Ok(DfuDiscoveryInfo {
            interface_number,
            alt_settings,
            selected_alt_setting: None,
        });
    }

    Err("No DFU interface found in USB descriptors".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn poll_timeout_parses_little_endian() {
        // DFU_GETSTATUS layout: bStatus, bwPollTimeout[0..2], bState, iString.
        let status = [0x00, 0x34, 0x12, 0x00, 0x02, 0x00];
        assert_eq!(DfuDevice::poll_timeout_ms(status), 0x1234);
    }

    #[test]
    fn format_status_uses_expected_indices() {
        let status = [0x00, 0x01, 0x00, 0x00, 0x05, 0xaa];
        let s = format_status(status);
        assert!(s.contains("bStatus=0x00"));
        assert!(s.contains("bState=0x05"));
        assert!(s.contains("bwPollTimeout=1"));
        assert!(s.contains("iString=170"));
    }
}
