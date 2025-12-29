use btleplug::api::{Central, CentralEvent, Manager as _, Peripheral as _, ScanFilter};
use btleplug::platform::{Adapter, Manager, Peripheral};
use futures::stream::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

use crate::buffer::{self, Buffer, PACKET_SIZE};

// EMWaver BLE Service and Characteristic UUIDs (matching Android/iOS)
const SERVICE_UUID: &str = "45c7158e-0c3b-4e90-a847-452a15b14191";
const CMD_CHAR_UUID: &str = "46c7158e-0c3b-4e90-a847-452a15b14191";
const NOTIF_CHAR_UUID: &str = "47c7158e-0c3b-4e90-a847-452a15b14191";

// EMWaver BLE OTA Service and Characteristics (desktop-only for now)
const OTA_SERVICE_UUID: &str = "45c7158e-0c3b-4e90-a847-452a15b14192";
const OTA_CTRL_CHAR_UUID: &str = "45c7158e-0c3b-4e90-a847-452a15b14193";
const OTA_DATA_CHAR_UUID: &str = "45c7158e-0c3b-4e90-a847-452a15b14194";
const OTA_STATUS_CHAR_UUID: &str = "45c7158e-0c3b-4e90-a847-452a15b14195";
const DEVICE_NAME: &str = "EMWaver";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BLEStatus {
    pub connected: bool,
    pub scanning: bool,
    pub device_name: Option<String>,
    pub device_address: Option<String>,
}

pub struct BLEState {
    pub adapter: Arc<AsyncMutex<Option<Adapter>>>,
    pub peripheral: Arc<AsyncMutex<Option<Peripheral>>>,
    pub status: Arc<AsyncMutex<BLEStatus>>,
    pub buffer: Arc<Mutex<Buffer>>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn to_packet64(data: Vec<u8>) -> Result<[u8; PACKET_SIZE], String> {
    if data.len() > PACKET_SIZE {
        return Err(format!("Command too large: {} bytes (max {})", data.len(), PACKET_SIZE));
    }
    let mut packet = [0u8; PACKET_SIZE];
    packet[..data.len()].copy_from_slice(&data);
    Ok(packet)
}

impl BLEState {
    pub fn new(buffer: Arc<Mutex<Buffer>>) -> Self {
        Self {
            adapter: Arc::new(AsyncMutex::new(None)),
            peripheral: Arc::new(AsyncMutex::new(None)),
            status: Arc::new(AsyncMutex::new(BLEStatus {
                connected: false,
                scanning: false,
                device_name: None,
                device_address: None,
            })),
            buffer,
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

        // Spawn task to handle events
        let status_clone = Arc::clone(&self.status);
        let peripheral_clone = Arc::clone(&self.peripheral);
        let buffer_clone = Arc::clone(&self.buffer);
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
            let Ok(mut stream) = adapter_clone.events().await else {
                eprintln!("Failed to get BLE event stream");
                let mut status = status_clone.lock().await;
                status.scanning = false;
                return;
            };
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
                                            // Keep scanning=true to indicate "working on it" (connecting)
                                        }
                                        
                                        // Stop scanning (hardware)
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
                                                let ota_service_uuid = Uuid::parse_str(OTA_SERVICE_UUID).unwrap();
                                                let ota_status_uuid = Uuid::parse_str(OTA_STATUS_CHAR_UUID).unwrap();

                                                let mut notify_characteristics = Vec::new();
                                                for service in services {
                                                    if service.uuid != service_uuid && service.uuid != ota_service_uuid {
                                                        continue;
                                                    }

                                                    for characteristic in service.characteristics.iter() {
                                                        let is_target_notify = characteristic.uuid == notif_char_uuid
                                                            || characteristic.uuid == ota_status_uuid;
                                                        if !is_target_notify {
                                                            continue;
                                                        }
                                                        if !characteristic.properties.contains(btleplug::api::CharPropFlags::NOTIFY) {
                                                            continue;
                                                        }
                                                        notify_characteristics.push(characteristic.clone());
                                                    }
                                                }

                                                for characteristic in &notify_characteristics {
                                                    let _ = peripheral.subscribe(characteristic).await;
                                                }

                                                let peripheral_for_notifications = peripheral.clone();
                                                if let Ok(mut notification_stream) = peripheral_for_notifications.notifications().await {
                                                    let buffer_clone = Arc::clone(&buffer_clone);
                                                    tokio::spawn(async move {
                                                        while let Some(data) = notification_stream.next().await {
                                                            if data.value.len() != PACKET_SIZE {
                                                                continue;
                                                            }
                                                            let mut packet = [0u8; PACKET_SIZE];
                                                            packet.copy_from_slice(&data.value);
                                                            if let Ok(mut guard) = buffer_clone.lock() {
                                                                buffer::append_rx_packet(&mut *guard, &packet, now_ms());
                                                            }
                                                        }
                                                    });
                                                }
                                                
                                                // Update status: Connected and finished scanning/connecting
                                                {
                                                    let mut status = status_clone.lock().await;
                                                    status.connected = true;
                                                    status.scanning = false; 
                                                }
                                                
                                                // Store peripheral
                                                {
                                                    let mut peripheral_guard = peripheral_clone.lock().await;
                                                    *peripheral_guard = Some(peripheral_for_storage);
                                                }
                                            } else {
                                                // Service discovery failed
                                                 let mut status = status_clone.lock().await;
                                                 status.scanning = false;
                                            }
                                        } else {
                                            // Connection failed
                                            let mut status = status_clone.lock().await;
                                            status.scanning = false;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    CentralEvent::DeviceConnected(_) => {
                        // Don't set connected=true here, wait for service discovery
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
                        let packet = to_packet64(data)?;
                        peripheral
                            .write(
                                &characteristic,
                                &packet,
                                btleplug::api::WriteType::WithResponse,
                            )
                            .await
                            .map_err(|e| format!("Failed to write: {}", e))?;
                        if let Ok(mut guard) = self.buffer.lock() {
                            buffer::append_tx_packet(&mut *guard, &packet, now_ms());
                        }
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

    async fn find_char(
        &self,
        service_uuid: &str,
        char_uuid: &str,
    ) -> Result<btleplug::api::Characteristic, String> {
        let peripheral_guard = self.peripheral.lock().await;
        let peripheral = peripheral_guard.as_ref().ok_or("Not connected to device")?;
        let services = peripheral.services();

        let service_uuid = Uuid::parse_str(service_uuid).map_err(|e| e.to_string())?;
        let char_uuid = Uuid::parse_str(char_uuid).map_err(|e| e.to_string())?;

        services
            .iter()
            .find(|s| s.uuid == service_uuid)
            .and_then(|s| s.characteristics.iter().find(|c| c.uuid == char_uuid))
            .cloned()
            .ok_or_else(|| "Characteristic not found".to_string())
    }

    pub async fn ota_write_control(&self, data: &[u8]) -> Result<(), String> {
        if data.is_empty() {
            return Err("Control payload is empty".to_string());
        }
        let characteristic = self.find_char(OTA_SERVICE_UUID, OTA_CTRL_CHAR_UUID).await?;

        let peripheral_guard = self.peripheral.lock().await;
        let peripheral = peripheral_guard.as_ref().ok_or("Not connected to device")?;
        peripheral
            .write(&characteristic, data, btleplug::api::WriteType::WithResponse)
            .await
            .map_err(|e| format!("Failed to write OTA control: {}", e))?;
        Ok(())
    }

    pub async fn ota_write_data(&self, data: &[u8]) -> Result<(), String> {
        if data.is_empty() {
            return Ok(());
        }
        let characteristic = self.find_char(OTA_SERVICE_UUID, OTA_DATA_CHAR_UUID).await?;

        let peripheral_guard = self.peripheral.lock().await;
        let peripheral = peripheral_guard.as_ref().ok_or("Not connected to device")?;
        peripheral
            .write(&characteristic, data, btleplug::api::WriteType::WithoutResponse)
            .await
            .map_err(|e| format!("Failed to write OTA data: {}", e))?;
        Ok(())
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
