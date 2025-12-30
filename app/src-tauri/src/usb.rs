use serialport::{DataBits, FlowControl, Parity, SerialPort, SerialPortInfo, SerialPortType, StopBits};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::io::{Read, Write};
use tokio::sync::{Mutex as AsyncMutex, Notify};
use serde::{Deserialize, Serialize};
use tauri::async_runtime::spawn_blocking;
use std::collections::HashSet;

use crate::buffer::{self, Buffer, PACKET_SIZE};

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

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

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

    pub async fn list_ports() -> Result<Vec<String>, String> {
        spawn_blocking(move || {
            let ports = serialport::available_ports().map_err(|e| format!("Failed to list ports: {}", e))?;
            let (mut usb, mut other): (Vec<SerialPortInfo>, Vec<SerialPortInfo>) =
                ports.into_iter().partition(|p| matches!(p.port_type, SerialPortType::UsbPort(_)));

            if usb.is_empty() {
                usb.append(&mut other);
            }

            let mut names: Vec<String> = usb.into_iter().map(|p| p.port_name).collect();

            // macOS has both /dev/tty.* and /dev/cu.* entries for the same device. The tty device
            // can behave like a "call-in" device and appear unresponsive for outbound use. Prefer cu.
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

                // Drop common non-device pseudo-ports that confuse selection on macOS.
                names.retain(|n| !n.contains("Bluetooth-Incoming-Port"));
            }

            names.sort_by_key(|n| {
                // Prefer real USB CDC devices first.
                if n.contains("usbmodem") {
                    (0, n.clone())
                } else if n.contains("usbserial") {
                    (1, n.clone())
                } else {
                    (2, n.clone())
                }
            });
            Ok(names)
        })
        .await
        .map_err(|e| format!("Task failed: {}", e))?
    }

    pub async fn connect(&self, port_name: String) -> Result<(), String> {
        let port_name_for_open = Self::normalize_port_name_for_platform(&port_name);
        
        // Open port in blocking task
        let port = spawn_blocking(move || {
            let mut port = serialport::new(port_name_for_open, 115200)
                .data_bits(DataBits::Eight)
                .parity(Parity::None)
                .stop_bits(StopBits::One)
                .flow_control(FlowControl::None)
                .timeout(Duration::from_millis(100))
                .open()
                .map_err(|e| {
                    let message = e.to_string();
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
                })?;

            // Many CDC devices expect DTR/RTS asserted by the host.
            let _ = port.write_data_terminal_ready(true);
            let _ = port.write_request_to_send(true);
            Ok::<Box<dyn SerialPort + Send>, String>(port)
        })
        .await
        .map_err(|e| format!("Task failed: {}", e))??;

        {
            let mut port_guard = self.port.lock().await;
            *port_guard = Some(port);
            
            let mut status = self.status.lock().await;
            status.connected = true;
            status.device_path = Some(port_name.clone());
            
            let mut running = self.running.lock().await;
            *running = true;
        }

        // Start reading thread
        let running_clone = Arc::clone(&self.running);
        let buffer_clone = Arc::clone(&self.buffer);
        let rx_notify_clone = Arc::clone(&self.rx_notify);

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
            let packet_size: usize = 50; // match Android pacing (<= 64B endpoint packet)
            let base_period = Duration::from_millis(4);
            let flow_delta = Duration::from_millis(1);

            std::thread::sleep(Duration::from_millis(20));

            let mut last_status: u16 = 0;
            let mut next_send_at = std::time::Instant::now();

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

                // Pacing rules (roughly matching Android thresholds for a 512B circular buffer).
                next_send_at += base_period;
                if last_status > 300 {
                    next_send_at += flow_delta;
                } else if last_status < 200 {
                    if next_send_at.duration_since(std::time::Instant::now()) > flow_delta {
                        next_send_at -= flow_delta;
                    }
                }

                let now = std::time::Instant::now();
                if next_send_at > now {
                    std::thread::sleep(next_send_at - now);
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
