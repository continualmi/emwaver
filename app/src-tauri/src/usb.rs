use serialport::{DataBits, FlowControl, Parity, SerialPort, SerialPortInfo, SerialPortType, StopBits};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::io::{Read, Write};
use tokio::sync::{Mutex as AsyncMutex, Notify};
use serde::{Deserialize, Serialize};
use tauri::async_runtime::spawn_blocking;
#[cfg(target_os = "macos")]
use std::collections::HashSet;

use crate::buffer::{self, Buffer, PACKET_SIZE};
use emwaver_buffer_core::tx;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct USBStatus {
    pub connected: bool,
    pub device_path: Option<String>,
}

pub struct USBState {
    pub port: Arc<AsyncMutex<Option<Box<dyn SerialPort + Send>>>>,
    pub status: Arc<AsyncMutex<USBStatus>>,
    pub running: Arc<AsyncMutex<bool>>,
    pub buffer: Arc<Mutex<Buffer>>,
    pub rx_notify: Arc<Notify>,
    pub in_flight: Arc<AsyncMutex<()>>,
}

unsafe impl Send for USBState {}
unsafe impl Sync for USBState {}

#[derive(Debug)]
struct OpenPortError {
    rendered: String,
    is_not_found: bool,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

const EMWAVER_STM32_VID: u16 = 0x0483;
const EMWAVER_STM32_USB_PID_FS: u16 = 0x5740;

impl USBState {
    pub fn new(buffer: Arc<Mutex<Buffer>>, rx_notify: Arc<Notify>) -> Self {
        Self {
            port: Arc::new(AsyncMutex::new(None)),
            status: Arc::new(AsyncMutex::new(USBStatus {
                connected: false,
                device_path: None,
            })),
            running: Arc::new(AsyncMutex::new(false)),
            buffer,
            rx_notify,
            in_flight: Arc::new(AsyncMutex::new(())),
        }
    }

    fn is_not_found_message(message: &str) -> bool {
        let msg = message.to_ascii_lowercase();
        msg.contains("no such file or directory")
            || msg.contains("no such file")
            || msg.contains("no such device")
            || msg.contains("device not found")
            || msg.contains("the system cannot find the file specified")
    }

    fn render_open_error(message: &str) -> String {
        if message.contains("Permission denied") {
            format!(
                "Failed to open port (permission denied): {}. On Linux, ensure your user is in the 'dialout' group and re-login.",
                message
            )
        } else if message.contains("Device or resource busy") || message.contains("Resource busy") {
            format!(
                "Failed to open port (busy): {}. Close any other serial monitors (idf.py monitor, screen, ModemManager) and try again.",
                message
            )
        } else {
            format!("Failed to open port: {}", message)
        }
    }

    fn open_port_blocking(port_name_for_open: &str) -> Result<Box<dyn SerialPort + Send>, OpenPortError> {
        let mut port = serialport::new(port_name_for_open, 115200)
            .data_bits(DataBits::Eight)
            .parity(Parity::None)
            .stop_bits(StopBits::One)
            .flow_control(FlowControl::None)
            .timeout(Duration::from_millis(100))
            .open()
            .map_err(|e| {
                let message = e.to_string();
                OpenPortError {
                    is_not_found: Self::is_not_found_message(&message),
                    rendered: Self::render_open_error(&message),
                }
            })?;

        let _ = port.write_data_terminal_ready(true);
        let _ = port.write_request_to_send(true);
        Ok(port)
    }

    fn is_emwaver_waver_usb_port(port: &SerialPortInfo) -> bool {
        let SerialPortType::UsbPort(usb) = &port.port_type else {
            return false;
        };

        if usb.vid == EMWAVER_STM32_VID && usb.pid == EMWAVER_STM32_USB_PID_FS {
            return true;
        }

        if usb
            .manufacturer
            .as_deref()
            .is_some_and(|m| m.eq_ignore_ascii_case("EMWaver"))
        {
            return true;
        }

        usb.product.as_deref().is_some_and(|p| {
            matches!(
                p,
                "ISM Waver" | "EMWaver" | "GPIO Waver" | "IR Waver"
            )
        })
    }

    fn list_ports_blocking() -> Result<Vec<String>, String> {
        let ports = serialport::available_ports().map_err(|e| format!("Failed to list ports: {}", e))?;
        let usb: Vec<SerialPortInfo> = ports
            .into_iter()
            .filter(|p| matches!(p.port_type, SerialPortType::UsbPort(_)))
            .filter(Self::is_emwaver_waver_usb_port)
            .collect();

        if usb.is_empty() {
            return Ok(Vec::new());
        }

        let mut names: Vec<String> = usb.into_iter().map(|p| p.port_name).collect();

        #[cfg(target_os = "macos")]
        {
            let set: HashSet<String> = names.iter().cloned().collect();
            names.retain(|n| {
                if let Some(rest) = n.strip_prefix("/dev/tty.") {
                    !set.contains(&format!("/dev/cu.{}", rest))
                } else {
                    true
                }
            });

            names.retain(|n| !n.contains("Bluetooth-Incoming-Port"));
        }

        names.sort_by_key(|n| {
            if n.contains("usbmodem") {
                (0, n.clone())
            } else if n.contains("usbserial") {
                (1, n.clone())
            } else {
                (2, n.clone())
            }
        });

        Ok(names)
    }

    fn choose_fallback_port(requested: &str, candidates: &[String]) -> Option<String> {
        if candidates.iter().any(|c| c == requested) {
            return Some(requested.to_string());
        }

        let family = if requested.contains("usbmodem") {
            Some("usbmodem")
        } else if requested.contains("usbserial") {
            Some("usbserial")
        } else {
            None
        };

        let mut filtered: Vec<&String> = match family {
            Some(tag) => candidates.iter().filter(|c| c.contains(tag)).collect(),
            None => candidates.iter().collect(),
        };

        if filtered.len() == 1 {
            return Some(filtered.remove(0).clone());
        }

        None
    }

    pub async fn list_ports() -> Result<Vec<String>, String> {
        spawn_blocking(move || {
            Self::list_ports_blocking()
        })
        .await
        .map_err(|e| format!("Task failed: {}", e))?
    }

    pub async fn connect(&self, port_name: String) -> Result<(), String> {
        // Ensure we don't keep stale read threads/handles around when reconnecting.
        if self.status.lock().await.connected {
            let _ = self.disconnect().await;
        }

        let requested = Self::normalize_port_name_for_platform(&port_name);

        let (opened_name, port) = spawn_blocking(move || {
            match Self::open_port_blocking(&requested) {
                Ok(port) => Ok::<(String, Box<dyn SerialPort + Send>), String>((requested.clone(), port)),
                Err(err) if err.is_not_found => {
                    let candidates = Self::list_ports_blocking()?;
                    let Some(fallback) = Self::choose_fallback_port(&requested, &candidates) else {
                        let mut message = err.rendered;
                        if !candidates.is_empty() {
                            message.push_str(". Available ports: ");
                            message.push_str(&candidates.join(", "));
                        } else {
                            message.push_str(". No serial ports are currently available.");
                        }
                        message.push_str(" (Try refreshing the port list.)");
                        return Err(message);
                    };

                    let port = Self::open_port_blocking(&fallback).map_err(|e| e.rendered)?;
                    Ok((fallback, port))
                }
                Err(err) => Err(err.rendered),
            }
        })
        .await
        .map_err(|e| format!("Task failed: {}", e))??;

        {
            let mut port_guard = self.port.lock().await;
            *port_guard = Some(port);
            
            let mut status = self.status.lock().await;
            status.connected = true;
            status.device_path = Some(opened_name.clone());
            
            let mut running = self.running.lock().await;
            *running = true;
        }

        // Start reading thread
        let running_clone = Arc::clone(&self.running);
        let buffer_clone = Arc::clone(&self.buffer);
        let rx_notify_clone = Arc::clone(&self.rx_notify);
        let port_state_clone = Arc::clone(&self.port);
        let status_clone = Arc::clone(&self.status);

        // We need a way to read from the port without locking it forever.
        // Since SerialPort is not async, we need a dedicated thread that polls or reads with timeout.
        // We'll use spawn_blocking for the reading loop? No, that would block one thread forever.
        // Better to use a standard thread or a blocking task that loops.
        // Since we need to share the port, and SerialPort is not thread-safe for sharing between read/write easily without Mutex.
        // But if we lock the mutex to read, we can't write.
        // Solution: Split the serial port? serialport crate allows try_clone().
        
        let mut read_port = {
            let mut port_guard = self.port.lock().await;
            if let Some(p) = port_guard.as_mut() {
                 p.try_clone().map_err(|e| format!("Failed to clone port: {}", e))?
            } else {
                return Err("Port not initialized".to_string());
            }
        };

        std::thread::spawn(move || {
            let mut buffer = [0u8; 1024];
            let mut pending: Vec<u8> = Vec::new();
            let mark_disconnected = || {
                {
                    let mut running = running_clone.blocking_lock();
                    *running = false;
                }
                {
                    let mut port_guard = port_state_clone.blocking_lock();
                    *port_guard = None;
                }
                {
                    let mut status = status_clone.blocking_lock();
                    status.connected = false;
                    status.device_path = None;
                }
            };
            loop {
                // Check if we should stop
                {
                    let running = match running_clone.blocking_lock() {
                        guard => *guard,
                    };
                    if !running {
                        break;
                    }
                }

                match read_port.read(&mut buffer) {
                    Ok(bytes_read) => {
                            if bytes_read > 0 {
                                pending.extend_from_slice(&buffer[0..bytes_read]);
                                while pending.len() >= PACKET_SIZE {
                                    let chunk = pending.drain(0..PACKET_SIZE).collect::<Vec<u8>>();
                                    let ts_ms = now_ms();
                                    if let Ok(mut guard) = buffer_clone.lock() {
                                        buffer::append_rx_bytes(&mut *guard, &chunk, ts_ms);
                                    }
                                    rx_notify_clone.notify_waiters();
                                }
                            }
                        }
                    Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                        // Timeout is fine, just continue
                    }
                    Err(_) => {
                        // Error (e.g. disconnected), stop loop
                        mark_disconnected();
                        break;
                    }
                }
            }
        });

        Ok(())
    }

    pub async fn disconnect(&self) -> Result<(), String> {
        {
            let mut running = self.running.lock().await;
            *running = false;
        }
        
        // Give the read thread time to exit
        tokio::time::sleep(Duration::from_millis(200)).await;

        let mut port_guard = self.port.lock().await;
        *port_guard = None;

        let mut status = self.status.lock().await;
        status.connected = false;
        status.device_path = None;

        Ok(())
    }

    pub async fn send_packet(&self, data: Vec<u8>) -> Result<(), String> {
        let mut port_guard = self.port.lock().await;
        if let Some(port) = port_guard.as_mut() {
            if data.len() > PACKET_SIZE {
                return Err(format!("Command too large: {} bytes (max {})", data.len(), PACKET_SIZE));
            }
            let mut packet = [0u8; PACKET_SIZE];
            packet[..data.len()].copy_from_slice(&data);

            port.write_all(&packet).map_err(|e| format!("Failed to write: {}", e))?;
            port.flush().map_err(|e| format!("Failed to flush: {}", e))?;
            if let Ok(mut guard) = self.buffer.lock() {
                buffer::append_tx_packet(&mut *guard, &packet, now_ms());
            }
            Ok(())
        } else {
            Err("Not connected".to_string())
        }
    }

    pub async fn send_command(&self, data: Vec<u8>, timeout_ms: u64, packets: u32) -> Result<Vec<u8>, String> {
        let _in_flight = self.in_flight.lock().await;

        if let Ok(mut guard) = self.buffer.lock() {
            let count = buffer::rx_packet_count(&*guard);
            guard.rx_counter = count;
        }

        self.send_packet(data).await?;

        let want_packets = std::cmp::max(1, packets) as usize;
        let want_bytes = want_packets.saturating_mul(PACKET_SIZE);
        let mut out: Vec<u8> = Vec::with_capacity(want_bytes);

        let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_millis(timeout_ms.max(1));
        while out.len() < want_bytes {
            if let Some(pkt) = (|| {
                let mut guard = self.buffer.lock().ok()?;
                crate::buffer::next_rx_packet(&mut *guard)
            })() {
                out.extend_from_slice(&pkt.data);
                continue;
            }

            let now = tokio::time::Instant::now();
            if now >= deadline {
                return Err("Timed out waiting for response".to_string());
            }

            let remaining = deadline - now;
            tokio::time::timeout(remaining, self.rx_notify.notified())
                .await
                .map_err(|_| "Timed out waiting for response".to_string())?;
        }

        Ok(out)
    }

    pub async fn transmit_buffer(&self, data: Vec<u8>) -> Result<(), String> {
        let _in_flight = self.in_flight.lock().await;

        if data.is_empty() {
            return Err("Buffer is empty".to_string());
        }

        // Swap out the shared RX buffer while transmitting so response packets
        // don't contaminate sampler data stored in the same buffer.
        let (saved_rx, saved_rx_ts, saved_counter) = {
            let mut guard = self
                .buffer
                .lock()
                .map_err(|_| "Failed to lock buffer".to_string())?;
            let saved_rx = std::mem::take(&mut guard.rx_bytes);
            let saved_rx_ts = std::mem::take(&mut guard.rx_ts_ms);
            let saved_counter = guard.rx_counter;
            guard.rx_counter = 0;
            (saved_rx, saved_rx_ts, saved_counter)
        };

        let mut write_port = {
            let mut port_guard = self.port.lock().await;
            if let Some(p) = port_guard.as_mut() {
                p.try_clone().map_err(|e| format!("Failed to clone port: {e}"))?
            } else {
                return Err("Not connected".to_string());
            }
        };

	        let buffer_clone = Arc::clone(&self.buffer);
	        let write_result = spawn_blocking(move || {
	            // STM32 transmit mode uses a small (512B) circular RX buffer and emits `BS` status
	            // packets as flow-control. If we flood the link, the device returns USBD_FAIL and
	            // stops accepting OUT packets, which makes retransmit stop mid-way.
	            let profile = tx::UsbTxProfile::default();
	            let packet_size: usize = profile.packet_size; // <= 64B endpoint packet

	            std::thread::sleep(Duration::from_millis(20));

	            let mut last_status: u16 = 0;
	            let start = std::time::Instant::now();
	            let mut next_send_at_ns: i64 = 0;

	            for chunk in data.chunks(packet_size) {
	                // Drain buffer-status packets (if any) to update flow-control state.
	                if let Ok(mut guard) = buffer_clone.lock() {
                    loop {
                        let pkt = crate::buffer::next_rx_packet(&mut *guard);
                        let Some(pkt) = pkt else { break };
                        if let Some(status) = emwaver_buffer_core::status::parse_bs(&pkt.data) {
                            last_status = status;
                        }
                    }
                }

                write_port
                    .write_all(chunk)
                    .map_err(|e| format!("Failed to write: {e}"))?;

                // Log TX as 64B entries (padded) for the home monitor.
                if let Ok(mut guard) = buffer_clone.lock() {
                    let mut packet = [0u8; PACKET_SIZE];
                    packet[..chunk.len()].copy_from_slice(chunk);
	                    buffer::append_tx_packet(&mut *guard, &packet, now_ms());
	                }

	                next_send_at_ns = next_send_at_ns.saturating_add(profile.period_ns);
	                next_send_at_ns =
	                    tx::usb_adjust_deadline_ns(profile, next_send_at_ns, last_status as i32);

	                let now_ns = start.elapsed().as_nanos() as i64;
	                let sleep_ns = next_send_at_ns.saturating_sub(now_ns);
	                if sleep_ns > 0 {
	                    std::thread::sleep(Duration::from_nanos(sleep_ns as u64));
	                }
	            }

	            write_port.flush().map_err(|e| format!("Failed to flush: {e}"))?;
	            Ok::<(), String>(())
	        })
        .await
        .map_err(|e| format!("Task failed: {e}"))?;

        // Restore sampler RX buffer (discarding packets accumulated during transmit).
        if let Ok(mut guard) = self.buffer.lock() {
            guard.rx_bytes = saved_rx;
            guard.rx_ts_ms = saved_rx_ts;
            guard.rx_counter = saved_counter;
        }

        write_result
    }

    fn normalize_port_name_for_platform(port_name: &str) -> String {
        let trimmed = port_name.trim();
        #[cfg(target_os = "macos")]
        {
            if let Some(rest) = trimmed.strip_prefix("/dev/tty.") {
                let candidate = format!("/dev/cu.{rest}");
                if std::path::Path::new(&candidate).exists() {
                    return candidate;
                }
                return trimmed.to_string();
            }
        }
        trimmed.to_string()
    }

    pub async fn get_status(&self) -> USBStatus {
        self.status.lock().await.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::USBState;

    #[test]
    fn choose_fallback_port_prefers_single_family_match() {
        let candidates = vec![
            "/dev/cu.Bluetooth-Incoming-Port".to_string(),
            "/dev/cu.usbmodem101".to_string(),
        ];
        assert_eq!(
            USBState::choose_fallback_port("/dev/cu.usbmodem999", &candidates),
            Some("/dev/cu.usbmodem101".to_string())
        );
    }

    #[test]
    fn choose_fallback_port_is_none_when_ambiguous() {
        let candidates = vec![
            "/dev/cu.usbmodem101".to_string(),
            "/dev/cu.usbmodem102".to_string(),
        ];
        assert_eq!(USBState::choose_fallback_port("/dev/cu.usbmodem999", &candidates), None);
    }
}
