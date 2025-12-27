use serialport::{DataBits, FlowControl, Parity, SerialPort, SerialPortInfo, SerialPortType, StopBits};
use std::sync::Arc;
use std::time::Duration;
use std::io::{Read, Write};
use tokio::sync::{mpsc, Mutex as AsyncMutex};
use serde::{Deserialize, Serialize};
use tauri::async_runtime::spawn_blocking;
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct USBStatus {
    pub connected: bool,
    pub device_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct USBNotification {
    pub data: Vec<u8>,
    pub timestamp: u64,
}

pub struct USBState {
    pub port: Arc<AsyncMutex<Option<Box<dyn SerialPort + Send>>>>,
    pub status: Arc<AsyncMutex<USBStatus>>,
    pub notification_tx: Arc<AsyncMutex<Option<mpsc::Sender<USBNotification>>>>,
    pub notification_rx: Arc<AsyncMutex<Option<mpsc::Receiver<USBNotification>>>>,
    pub running: Arc<AsyncMutex<bool>>,
}

unsafe impl Send for USBState {}
unsafe impl Sync for USBState {}

impl USBState {
    pub fn new() -> Self {
        Self {
            port: Arc::new(AsyncMutex::new(None)),
            status: Arc::new(AsyncMutex::new(USBStatus {
                connected: false,
                device_path: None,
            })),
            notification_tx: Arc::new(AsyncMutex::new(None)),
            notification_rx: Arc::new(AsyncMutex::new(None)),
            running: Arc::new(AsyncMutex::new(false)),
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

        // Setup notification channel
        {
            let mut tx_guard = self.notification_tx.lock().await;
            let mut rx_guard = self.notification_rx.lock().await;
            if tx_guard.is_none() {
                let (tx, rx) = mpsc::channel(100);
                *tx_guard = Some(tx);
                *rx_guard = Some(rx);
            }
        }

        // Start reading thread
        let port_clone = Arc::clone(&self.port);
        let notification_tx_clone = Arc::clone(&self.notification_tx);
        let running_clone = Arc::clone(&self.running);

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
            loop {
                // Check if we should stop
                {
                    let running = match running_clone.blocking_lock() {
                        mut guard => *guard,
                    };
                    if !running {
                        break;
                    }
                }

                match read_port.read(&mut buffer) {
                    Ok(bytes_read) => {
                        if bytes_read > 0 {
                            let data = buffer[0..bytes_read].to_vec();
                            let notification = USBNotification {
                                data,
                                timestamp: std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap()
                                    .as_millis() as u64,
                            };
                            
                            // Send to channel
                            let tx_guard = notification_tx_clone.blocking_lock();
                            if let Some(tx) = tx_guard.as_ref() {
                                let _ = tx.blocking_send(notification);
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
            port.write_all(&data).map_err(|e| format!("Failed to write: {}", e))?;
            if Self::looks_like_ascii_command(&data) && !matches!(data.last(), Some(b'\n') | Some(b'\r')) {
                port.write_all(b"\n").map_err(|e| format!("Failed to write newline: {}", e))?;
            }
            port.flush().map_err(|e| format!("Failed to flush: {}", e))?;
            Ok(())
        } else {
            Err("Not connected".to_string())
        }
    }

    fn normalize_port_name_for_platform(port_name: &str) -> String {
        #[cfg(target_os = "macos")]
        {
            if let Some(rest) = port_name.strip_prefix("/dev/tty.") {
                return format!("/dev/cu.{rest}");
            }
        }
        port_name.to_string()
    }

    fn looks_like_ascii_command(data: &[u8]) -> bool {
        if data.is_empty() {
            return false;
        }
        if data.iter().any(|b| *b == 0u8) {
            return false;
        }
        data.iter().all(|b| matches!(b, b'\n' | b'\r' | b'\t' | 0x20..=0x7e))
    }

    pub async fn get_status(&self) -> USBStatus {
        self.status.lock().await.clone()
    }

    pub async fn get_notification(&self) -> Option<USBNotification> {
        let mut rx_guard = self.notification_rx.lock().await;
        if let Some(rx) = rx_guard.as_mut() {
            rx.try_recv().ok()
        } else {
            None
        }
    }
}
