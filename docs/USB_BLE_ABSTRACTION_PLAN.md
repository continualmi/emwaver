# USB/BLE Communication Abstraction Plan

## Executive Summary

This document analyzes the differences between the old STM32/USB implementation and the current ESP32-S3/BLE implementation, and proposes a plan to abstract the communication layer to support both protocols simultaneously in the Android app.

## Current State Analysis

### Old Implementation (STM32 + USB CDC)

**Firmware (`emwaver-firmware`):**
- **Microcontroller**: STM32F042G6UX
- **Communication**: USB CDC (USB Serial)
- **Protocol**: Direct bulk packet handling in main loop
- **Key Functions**:
  - `CDC_Transmit_FS()` - Send data to host
  - `CDC_Receive_FS()` - Receive data from host
  - `CDC_SendResponsePkt_FS()` - Send response packets
  - `CDC_GetRxBufferBytesAvailable_FS()` - Check buffer status
  - `CDC_SetBufferType_FS()` - Switch between packet/circular/double buffer modes
- **Command Processing**: Direct byte array parsing in main loop (`bulk_packet` array)
- **Buffer Management**: Circular buffer for streaming data (sampler mode)

**Android App (`emwaver-androidapp`):**
- **Service**: `USBService.java`
- **Library**: `usb-serial-for-android` (UsbSerialPort)
- **Connection**: USB device connection via Android USB APIs
- **Key Methods**:
  - `write(byte[] bytes)` - Send command
  - `sendCommand(byte[] command, int timeout)` - Send and wait for response
  - `onNewData(byte[] data)` - Callback for received data
  - `transmitBuffer()` - Stream buffer with flow control
- **Native Methods**: Same JNI interface (`storeBulkPkt`, `getCommand`, etc.)

### Current Implementation (ESP32-S3 + BLE)

**Firmware (`emwaver/main`):**
- **Microcontroller**: ESP32-S3
- **Communication**: Bluetooth Low Energy (BLE) via NimBLE
- **Protocol**: GATT characteristics (command write, notification read)
- **Key Functions**:
  - `ble_server_notify()` - Send notifications to client
  - `ble_server_init()` - Initialize BLE server with command queue
  - `BLE_GetRxBufferBytesAvailable()` - Check buffer status
  - `ble_set_transmitter_mode()` - Enable/disable streaming mode
- **Command Processing**: FreeRTOS queue system (`command_registry`)
- **Buffer Management**: Circular buffer in BLE server for streaming

**Android App (`emwaver/android`):**
- **Service**: `BLEService.java`
- **Library**: Android BLE APIs (BluetoothGatt, BluetoothGattCharacteristic)
- **Connection**: BLE scanning, connection, service discovery
- **Key Methods**:
  - `write(byte[] bytes)` - Write to command characteristic
  - `sendCommand(byte[] command, int timeout)` - Send and wait for response
  - `onCharacteristicChanged()` - Callback for notifications
  - `transmitBuffer()` - Stream buffer with flow control
- **Native Methods**: Same JNI interface (`storeBulkPkt`, `getCommand`, etc.)

## Key Differences

### 1. Connection Model
- **USB**: Direct physical connection, permission-based access
- **BLE**: Wireless, scanning/discovery, pairing optional

### 2. Data Transfer
- **USB**: Bulk transfers, 64-byte packets (CDC), synchronous
- **BLE**: GATT characteristics, MTU negotiation (up to 256 bytes), asynchronous notifications

### 3. Protocol Layer
- **USB**: Raw byte streams, application-level framing
- **BLE**: GATT service/characteristic model, structured data

### 4. Buffer Management
- **USB**: Hardware FIFO + software circular buffer
- **BLE**: Software circular buffer only

### 5. Command Processing
- **USB**: Direct parsing in main loop
- **BLE**: Queue-based with FreeRTOS task

## Commonalities

1. **Command Protocol**: Both use Unix-style commands with `--flags` and positional arguments
2. **Native Interface**: Same JNI methods for buffer management
3. **Response Format**: Both send ASCII responses (`ok ...`, `err ...`)
4. **Streaming Mode**: Both support circular buffer mode for sampler
5. **Flow Control**: Both implement buffer status feedback

## Abstraction Architecture Proposal

### 1. Communication Interface

Create a common interface that both USB and BLE implementations will implement:

```java
public interface DeviceTransport {
    // Connection management
    boolean isConnected();
    void connect();
    void disconnect();
    
    // Data transfer
    void write(byte[] data);
    byte[] sendCommand(byte[] command, int timeout);
    void sendPacket(byte[] data);
    
    // Streaming
    void transmitBuffer();
    int getLogStatus();
    
    // Buffer management (delegates to native)
    void clearBuffer();
    int getBufferLength();
    void loadBuffer(byte[] data);
    byte[] getBuffer();
    
    // Callbacks
    void setDataCallback(DataCallback callback);
    
    interface DataCallback {
        void onDataReceived(byte[] data);
        void onConnectionStateChanged(boolean connected);
    }
}
```

### 2. Implementation Classes

**USBTransport** (wraps USBService):
- Implements `DeviceTransport`
- Uses `USBService` internally
- Handles USB permission requests
- Manages USB device connection lifecycle

**BLETransport** (wraps BLEService):
- Implements `DeviceTransport`
- Uses `BLEService` internally
- Handles BLE scanning and connection
- Manages GATT service discovery

### 3. Unified Service

**DeviceService** (new):
- Manages transport selection (USB vs BLE)
- Provides unified API to fragments
- Handles transport switching
- Maintains connection state

### 4. Migration Strategy

**Phase 1: Create Abstraction Layer**
1. Define `DeviceTransport` interface
2. Create `USBTransport` wrapper around existing `USBService`
3. Create `BLETransport` wrapper around existing `BLEService`
4. Create `DeviceService` that manages transports

**Phase 2: Update Fragments**
1. Replace direct `BLEService` references with `DeviceService`
2. Update fragments to use `DeviceTransport` interface
3. Add transport selection UI (USB/BLE toggle)

**Phase 3: STM32 Firmware Support**
1. Keep existing STM32 firmware as-is (USB CDC only)
2. Ensure command protocol compatibility
3. Test with USB transport

## Implementation Details

### DeviceTransport Interface

```java
package com.emwaver.emwaverandroidapp.transport;

public interface DeviceTransport {
    // Connection
    boolean isConnected();
    void connect();
    void disconnect();
    
    // Communication
    void write(byte[] data);
    byte[] sendCommand(byte[] command, int timeout);
    void sendPacket(byte[] data);
    void sendString(String command);
    
    // Streaming
    void transmitBuffer();
    int getLogStatus();
    
    // Buffer management (native)
    void clearBuffer();
    int getBufferLength();
    void loadBuffer(byte[] data);
    byte[] getBuffer();
    void storeBulkPkt(byte[] data);
    byte[] getCommand();
    Object[] compressDataBits(int rangeStart, int rangeEnd, int numberBins);
    void invertBuffer();
    
    // Callbacks
    void setDataCallback(DataCallback callback);
    
    interface DataCallback {
        void onDataReceived(byte[] data);
        void onConnectionStateChanged(boolean connected);
    }
}
```

### USBTransport Implementation

```java
package com.emwaver.emwaverandroidapp.transport;

public class USBTransport implements DeviceTransport {
    private USBService usbService;
    private DataCallback callback;
    private boolean connected = false;
    
    public USBTransport(Context context) {
        // Bind to USBService
    }
    
    @Override
    public boolean isConnected() {
        return connected && usbService != null && usbService.checkConnection();
    }
    
    @Override
    public void write(byte[] data) {
        if (usbService != null) {
            usbService.write(data);
        }
    }
    
    // ... implement all interface methods
}
```

### BLETransport Implementation

```java
package com.emwaver.emwaverandroidapp.transport;

public class BLETransport implements DeviceTransport {
    private BLEService bleService;
    private DataCallback callback;
    private boolean connected = false;
    
    public BLETransport(Context context) {
        // Bind to BLEService
    }
    
    @Override
    public boolean isConnected() {
        return connected && bleService != null && bleService.checkConnection();
    }
    
    @Override
    public void write(byte[] data) {
        if (bleService != null) {
            bleService.write(data);
        }
    }
    
    // ... implement all interface methods
}
```

### DeviceService (Unified Manager)

```java
package com.emwaver.emwaverandroidapp.transport;

public class DeviceService {
    public enum TransportType {
        USB,
        BLE
    }
    
    private DeviceTransport currentTransport;
    private USBTransport usbTransport;
    private BLETransport bleTransport;
    private TransportType activeTransport = TransportType.BLE; // Default
    
    public DeviceService(Context context) {
        usbTransport = new USBTransport(context);
        bleTransport = new BLETransport(context);
        currentTransport = bleTransport; // Default to BLE
    }
    
    public void setTransport(TransportType type) {
        if (currentTransport != null && currentTransport.isConnected()) {
            currentTransport.disconnect();
        }
        
        switch (type) {
            case USB:
                currentTransport = usbTransport;
                break;
            case BLE:
                currentTransport = bleTransport;
                break;
        }
        
        activeTransport = type;
    }
    
    public DeviceTransport getTransport() {
        return currentTransport;
    }
    
    // Delegate all methods to currentTransport
    public boolean isConnected() {
        return currentTransport != null && currentTransport.isConnected();
    }
    
    public void write(byte[] data) {
        if (currentTransport != null) {
            currentTransport.write(data);
        }
    }
    
    // ... delegate all other methods
}
```

## Firmware Considerations

### STM32 Firmware (USB CDC)
- **No changes needed** - existing firmware works as-is
- Command protocol is already compatible
- USB CDC implementation is complete

### ESP32-S3 Firmware (BLE)
- **No changes needed** - current implementation is correct
- Command protocol matches STM32 version
- BLE implementation is complete

## Testing Strategy

1. **Unit Tests**: Test abstraction layer with mock transports
2. **Integration Tests**: Test USB transport with STM32 device
3. **Integration Tests**: Test BLE transport with ESP32-S3 device
4. **UI Tests**: Test transport switching in fragments

## Migration Checklist

- [ ] Create `DeviceTransport` interface
- [ ] Implement `USBTransport` wrapper
- [ ] Implement `BLETransport` wrapper
- [ ] Create `DeviceService` manager
- [ ] Update `EMWaverFragment` to use `DeviceService`
- [ ] Update `SamplerFragment` to use `DeviceService`
- [ ] Update `IsmFragment` to use `DeviceService`
- [ ] Update `rfidFragment` to use `DeviceService`
- [ ] Update `ButtonsFragment` to use `DeviceService`
- [ ] Add transport selection UI
- [ ] Test USB connection with STM32
- [ ] Test BLE connection with ESP32-S3
- [ ] Test transport switching
- [ ] Update documentation

## Benefits

1. **Unified API**: Fragments don't need to know about transport details
2. **Easy Switching**: Can switch between USB and BLE at runtime
3. **Code Reuse**: Same command protocol and native methods
4. **Future-Proof**: Easy to add new transports (WiFi, etc.)
5. **Backward Compatible**: Existing STM32 firmware works without changes

## Risks and Mitigation

1. **Risk**: USB only works on Android (not iOS)
   - **Mitigation**: Transport selection can be platform-specific

2. **Risk**: Different connection models may cause issues
   - **Mitigation**: Abstract connection lifecycle in interface

3. **Risk**: Performance differences between USB and BLE
   - **Mitigation**: Document expected performance characteristics

## Next Steps

1. Review and approve this plan
2. Create abstraction interface and implementations
3. Migrate fragments to use new abstraction
4. Test with both STM32 and ESP32-S3 devices
5. Add transport selection UI
6. Update documentation
