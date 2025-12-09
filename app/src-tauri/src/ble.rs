use btleplug::api::{Central, CentralEvent, Manager as _, Peripheral as _, ScanFilter};
use btleplug::platform::{Adapter, Manager, Peripheral};
use futures::stream::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex as AsyncMutex};
use uuid::Uuid;

// EMWaver BLE Service and Characteristic UUIDs (matching Android/iOS)
const SERVICE_UUID: &str = "45c7158e-0c3b-4e90-a847-452a15b14191";
const CMD_CHAR_UUID: &str = "46c7158e-0c3b-4e90-a847-452a15b14191";
const NOTIF_CHAR_UUID: &str = "47c7158e-0c3b-4e90-a847-452a15b14191";
const DEVICE_NAME: &str = "EMWaver";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BLEStatus {
    pub connected: bool,
    pub scanning: bool,
    pub device_name: Option<String>,
    pub device_address: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BLENotification {
    pub data: Vec<u8>,
    pub timestamp: u64,
}

pub struct BLEState {
    pub adapter: Arc<AsyncMutex<Option<Adapter>>>,
    pub peripheral: Arc<AsyncMutex<Option<Peripheral>>>,
    pub status: Arc<AsyncMutex<BLEStatus>>,
    pub notification_tx: Arc<AsyncMutex<Option<mpsc::Sender<BLENotification>>>>,
    pub notification_rx: Arc<AsyncMutex<Option<mpsc::Receiver<BLENotification>>>>,
}

impl BLEState {
    pub fn new() -> Self {
        Self {
            adapter: Arc::new(AsyncMutex::new(None)),
            peripheral: Arc::new(AsyncMutex::new(None)),
            status: Arc::new(AsyncMutex::new(BLEStatus {
                connected: false,
                scanning: false,
                device_name: None,
                device_address: None,
            })),
            notification_tx: Arc::new(AsyncMutex::new(None)),
            notification_rx: Arc::new(AsyncMutex::new(None)),
        }
    }

    pub async fn initialize(&self) -> Result<(), String> {
        let manager = Manager::new().await.map_err(|e| format!("Failed to create BLE manager: {}", e))?;
        
        let adapters = manager.adapters().await.map_err(|e| format!("Failed to get adapters: {}", e))?;
        if adapters.is_empty() {
            return Err("No Bluetooth adapters found".to_string());
        }

        let mut adapter_guard = self.adapter.lock().await;
        *adapter_guard = Some(adapters.into_iter().next().unwrap());
        Ok(())
    }

    pub async fn start_scan(&self) -> Result<(), String> {
        let adapter_guard = self.adapter.lock().await;
        let adapter = adapter_guard.as_ref().ok_or("BLE not initialized")?;
        let adapter_clone = adapter.clone();
        drop(adapter_guard);
        
        {
            let mut status = self.status.lock().await;
            status.scanning = true;
        }
        
        adapter_clone
            .start_scan(ScanFilter::default())
            .await
            .map_err(|e| format!("Failed to start scan: {}", e))?;

        // Set up notification channel if not already set
        {
            let mut tx_guard = self.notification_tx.lock().await;
            let mut rx_guard = self.notification_rx.lock().await;
            if tx_guard.is_none() {
                let (tx, rx) = mpsc::channel(100);
                *tx_guard = Some(tx);
                *rx_guard = Some(rx);
            }
        }

        // Spawn task to handle events
        let status_clone = Arc::clone(&self.status);
        let peripheral_clone = Arc::clone(&self.peripheral);
        let notification_tx_clone = Arc::clone(&self.notification_tx);
        let adapter_for_timeout = adapter_clone.clone();
        let status_for_timeout = Arc::clone(&self.status);
        
        // Spawn timeout task to stop scan after 10 seconds if no device found
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
            let mut status = status_for_timeout.lock().await;
            if status.scanning && !status.connected {
                status.scanning = false;
                drop(status);
                let _ = adapter_for_timeout.stop_scan().await;
            }
        });
        
        tokio::spawn(async move {
            let mut stream = adapter_clone.events().await.unwrap();
            while let Some(event) = stream.next().await {
                match event {
                    CentralEvent::DeviceDiscovered(id) => {
                        if let Ok(peripheral) = adapter_clone.peripheral(&id).await {
                            if let Ok(Some(properties)) = peripheral.properties().await {
                                if let Some(name) = &properties.local_name {
                                    if name == DEVICE_NAME {
                                        // Found EMWaver device
                                        {
                                            let mut status = status_clone.lock().await;
                                            status.device_name = Some(name.clone());
                                            status.device_address = Some(id.to_string());
                                            status.scanning = false;
                                        }
                                        
                                        // Stop scanning
                                        let _ = adapter_clone.stop_scan().await;
                                        
                                        // Connect to device
                                        let peripheral_for_storage = peripheral.clone();
                                        if peripheral.connect().await.is_ok() {
                                            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                                            
                                            // Discover services
                                            if peripheral.discover_services().await.is_ok() {
                                                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                                                
                                                // Set up notifications
                                                let services = peripheral.services();
                                                let service_uuid = Uuid::parse_str(SERVICE_UUID).unwrap();
                                                let notif_char_uuid = Uuid::parse_str(NOTIF_CHAR_UUID).unwrap();
                                                
                                                for service in services {
                                                    if service.uuid == service_uuid {
                                                        for characteristic in service.characteristics.iter() {
                                                            if characteristic.uuid == notif_char_uuid {
                                                                if characteristic.properties.contains(btleplug::api::CharPropFlags::NOTIFY) {
                                                                    let peripheral_for_notifications = peripheral.clone();
                                                                    if peripheral.subscribe(characteristic).await.is_ok() {
                                                                        // Set up notification handler
                                                                        let tx_guard = notification_tx_clone.lock().await;
                                                                        if let Some(tx) = tx_guard.as_ref() {
                                                                            let tx_clone = tx.clone();
                                                                            drop(tx_guard);
                                                                            
                                                                            if let Ok(mut notification_stream) = peripheral_for_notifications.notifications().await {
                                                                                tokio::spawn(async move {
                                                                                    while let Some(data) = notification_stream.next().await {
                                                                                        let notification = BLENotification {
                                                                                            data: data.value,
                                                                                            timestamp: std::time::SystemTime::now()
                                                                                                .duration_since(std::time::UNIX_EPOCH)
                                                                                                .unwrap()
                                                                                                .as_millis() as u64,
                                                                                        };
                                                                                        let _ = tx_clone.send(notification).await;
                                                                                    }
                                                                                });
                                                                            }
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                                
                                                // Update status
                                                {
                                                    let mut status = status_clone.lock().await;
                                                    status.connected = true;
                                                }
                                                
                                                // Store peripheral
                                                {
                                                    let mut peripheral_guard = peripheral_clone.lock().await;
                                                    *peripheral_guard = Some(peripheral_for_storage);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    CentralEvent::DeviceConnected(_) => {
                        let mut status = status_clone.lock().await;
                        status.connected = true;
                    }
                    CentralEvent::DeviceDisconnected(_) => {
                        let mut status = status_clone.lock().await;
                        status.connected = false;
                        let mut peripheral_guard = peripheral_clone.lock().await;
                        *peripheral_guard = None;
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }

    pub async fn stop_scan(&self) -> Result<(), String> {
        let adapter_guard = self.adapter.lock().await;
        let adapter = adapter_guard.as_ref().ok_or("BLE not initialized")?;
        adapter.stop_scan().await.map_err(|e| format!("Failed to stop scan: {}", e))?;
        
        let mut status = self.status.lock().await;
        status.scanning = false;
        Ok(())
    }

    pub async fn disconnect(&self) -> Result<(), String> {
        let peripheral_guard = self.peripheral.lock().await;
        if let Some(peripheral) = peripheral_guard.as_ref() {
            peripheral.disconnect().await.map_err(|e| format!("Failed to disconnect: {}", e))?;
        }
        drop(peripheral_guard);
        
        let mut status = self.status.lock().await;
        status.connected = false;
        status.device_name = None;
        status.device_address = None;
        
        let mut peripheral_guard = self.peripheral.lock().await;
        *peripheral_guard = None;
        
        Ok(())
    }

    pub async fn send_packet(&self, data: Vec<u8>) -> Result<(), String> {
        let peripheral_guard = self.peripheral.lock().await;
        let peripheral = peripheral_guard.as_ref().ok_or("Not connected to device")?;
        
        let services = peripheral.services();
        let service_uuid = Uuid::parse_str(SERVICE_UUID).unwrap();
        let cmd_char_uuid = Uuid::parse_str(CMD_CHAR_UUID).unwrap();
        
        for service in services {
            if service.uuid == service_uuid {
                for characteristic in service.characteristics {
                    if characteristic.uuid == cmd_char_uuid {
                        peripheral
                            .write(&characteristic, &data, btleplug::api::WriteType::WithResponse)
                            .await
                            .map_err(|e| format!("Failed to write: {}", e))?;
                        return Ok(());
                    }
                }
            }
        }
        
        Err("Command characteristic not found".to_string())
    }

    pub async fn get_status(&self) -> BLEStatus {
        self.status.lock().await.clone()
    }

    pub async fn get_notification(&self) -> Option<BLENotification> {
        let mut rx_guard = self.notification_rx.lock().await;
        if let Some(rx) = rx_guard.as_mut() {
            rx.try_recv().ok()
        } else {
            None
        }
    }

    pub async fn transmit_buffer(&self, data: Vec<u8>) -> Result<(), String> {
        let peripheral_guard = self.peripheral.lock().await;
        let peripheral = peripheral_guard.as_ref().ok_or("Not connected to device")?;
        
        let services = peripheral.services();
        let service_uuid = Uuid::parse_str(SERVICE_UUID).unwrap();
        let cmd_char_uuid = Uuid::parse_str(CMD_CHAR_UUID).unwrap();
        
        let characteristic = services
            .iter()
            .find(|s| s.uuid == service_uuid)
            .and_then(|s| s.characteristics.iter().find(|c| c.uuid == cmd_char_uuid))
            .ok_or("Command characteristic not found")?;
        
        drop(peripheral_guard);

        if data.is_empty() {
            return Err("Buffer is empty".to_string());
        }

        // Flow control parameters (matching Android/iOS)
        let max_packet_size = 200;
        let min_packet_size = 128;
        let initial_packet_size = 188;
        let mut current_packet_size = max_packet_size;
        let fixed_delay_ms = 15u64;
        
        let target_buffer_level = 2048;
        let buffer_high_threshold = 3000;
        let buffer_low_threshold = 1000;
        let initial_fill_bytes = 2048;

        let total_bytes = data.len();
        let mut bytes_sent = 0;

        while bytes_sent < total_bytes {
            // Calculate packet size
            let remaining = total_bytes - bytes_sent;
            let packet_size = std::cmp::min(current_packet_size, remaining);
            let end = bytes_sent + packet_size;
            let packet = &data[bytes_sent..end];

            // Send packet
            let peripheral_guard = self.peripheral.lock().await;
            let peripheral = peripheral_guard.as_ref().ok_or("Not connected")?;
            peripheral
                .write(&characteristic, packet, btleplug::api::WriteType::WithoutResponse)
                .await
                .map_err(|e| format!("Failed to write packet: {}", e))?;
            drop(peripheral_guard);

            // Flow control logic (matching Android/iOS)
            if bytes_sent >= initial_fill_bytes {
                // In a real implementation, we'd check buffer status here
                // For now, use simple adaptive sizing
                // TODO: Add buffer status checking if firmware provides it
                if current_packet_size > initial_packet_size {
                    current_packet_size = std::cmp::max(min_packet_size, current_packet_size - 32);
                } else if current_packet_size < initial_packet_size {
                    current_packet_size = std::cmp::min(max_packet_size, current_packet_size + 32);
                }
            } else {
                current_packet_size = max_packet_size;
            }

            // Fixed delay between packets
            tokio::time::sleep(tokio::time::Duration::from_millis(fixed_delay_ms)).await;

            bytes_sent += packet_size;
        }

        Ok(())
    }
}
