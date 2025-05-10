# EMWaver Project Architecture and Structure

EMWaver is an open-source hardware and software platform for wireless experimentation, signal analysis, and device control. It features an ESP32-S3-based board with integrated sub-GHz (CC1101), infrared, USB-C, and GPIO expansion capabilities, complemented by powerful mobile apps for iOS and Android.

## Project Overview

EMWaver is designed as a versatile development board with a male USB-C connector that can plug directly into smartphones. The system consists of:

1. **Hardware**: ESP32-S3 board with CC1101 (sub-GHz), IR TX/RX, RFID support, and GPIO expansion
2. **Firmware**: ESP-IDF based firmware running on the ESP32-S3
3. **Mobile Apps**: Native apps for iOS (Swift/SwiftUI) and Android (Java)
4. **Documentation**: MkDocs-based documentation for users and developers

## Repository Structure

The repository is organized into four primary components:

```
emwaver-1/
├── main/               # ESP32 firmware (ESP-IDF)
├── ios/                # iOS app (Swift/SwiftUI)
├── android/            # Android app (Java)
└── docs/               # Documentation (MkDocs)
```

## 1. Firmware Architecture (`main/`)

The firmware runs on the ESP32-S3 microcontroller and serves as the bridge between the hardware components and the mobile apps.

### Key Files

- **main.c**: Main entry point with hardware initialization, task creation, and core functionality
- **ble_server.c/h**: BLE server implementation for mobile app communication
- **cc1101.c/h**: Driver for the CC1101 sub-GHz transceiver
- **mfrc522.c/h**: Driver for MFRC522 RFID module
- **badusb.c/h**: Implements USB HID keyboard (BadUSB) functionality

### Core Features

- **Signal Sampling & Transmission**: High-precision (10μs) RF signal sampling and replay 
- **BLE Communication**: Central interface for app control
- **BadUSB**: USB HID keyboard emulation for automation
- **RFID**: MFRC522-based RFID reading/writing

### Communication Flow

The firmware exposes a **BLE service** with two main characteristics:
- **Command Characteristic** (46c7158e-0c3b-4e90-a847-452a15b14191): Receives commands from mobile apps
- **Notification Characteristic** (47c7158e-0c3b-4e90-a847-452a15b14191): Sends data and responses to mobile apps

Commands are processed through a FreeRTOS queue with a dedicated command_task that dispatches actions to appropriate subsystems.

#### Command Processing

The firmware uses a command queue system:
```c
typedef struct {
    uint8_t data[256];
    uint16_t length;
} command_t;
```

Commands received via BLE are placed in this queue and processed by the command_task, which dispatches them to the appropriate handler based on the command prefix.

### RFID Implementation

The EMWaver includes a comprehensive implementation for MFRC522-based RFID operations:

- **Hardware Connection**: SPI interface shared with CC1101, with separate CS and RST pins
- **Card Operations**: Support for MIFARE Classic card operations:
  - Card detection (`PICC_REQIDL`, `PICC_REQALL`)
  - Anti-collision handling for multiple cards
  - Authentication with keys A/B (`PICC_AUTHENT1A`, `PICC_AUTHENT1B`)
  - Reading and writing blocks
  - Cryptographic operations with Crypto1 cypher
  
#### RFID Commands

The firmware processes RFID commands with the following format:
- `rfid cmd <command> [parameters]`: Send raw commands to the MFRC522
- `rfid detect`: Detect RFID cards in the field
- `rfid read <block>`: Read data from a specified block
- `rfid write <block> <data>`: Write data to a specified block
- `rfid auth <type> <block> <key>`: Authenticate to a block with a specified key
- `rfid select`: Select a specific card based on UID

#### RFID Response Format

RFID operations return data in the following format:
1. Status byte (MI_OK, MI_NOTAGERR, MI_ERR)
2. Optional data depending on the command:
   - For detection: UID bytes
   - For read operations: Block data (16 bytes)
   - For authentication: Success/failure

### BadUSB Implementation

EMWaver includes a BadUSB feature that allows it to emulate a USB HID keyboard when connected to a computer via the USB-C port:

- **Architecture**: Built on TinyUSB stack with HID device class
- **Core Features**:
  - Full keyboard emulation with modifiers (Shift, Ctrl, Alt, etc.)
  - USB HID descriptor and report implementation
  - ASCII to HID keycode translation (US QWERTY layout)
  - Configurable delays between keystrokes

#### BadUSB Commands

The firmware processes keyboard commands with the following format:
- `usb STRING <text>`: Type the specified text as keyboard input
- `usb ENTER`: Press the Enter key
- `usb DELAY <ms>`: Wait for the specified milliseconds
- `usb STRING_DELAY <ms>`: Set the delay between keystrokes (default: 10ms)

#### Implementation Details

- Uses a complete ASCII to HID keycode lookup table
- Handles key press-release timing (10ms default)
- Supports character delays for reliable input on slower systems
- Can be used for automation scripts, DuckyScript-like functionality

Example DuckyScript-like commands:
```
usb STRING_DELAY 50
usb STRING Hello, world!
usb ENTER
usb DELAY 2000
usb STRING This is EMWaver BadUSB
```

## 2. iOS App Architecture (`ios/`)

The iOS app is built with Swift/SwiftUI and provides a modern, native interface for controlling the EMWaver device from iOS devices.

### Structure

- **EMWaverApp.swift**: App entry point
- **ContentView.swift**: Main navigation structure

#### Managers
- **BLEManager.swift**: Core BLE communication with the EMWaver device
- **CC1101.swift**: Management of CC1101 transceiver features

#### Views
- **ISMView.swift**: Sub-GHz ISM band controls (433/868/915 MHz)
- **RFIDView.swift**: RFID reading/writing functionality
- **BLEView.swift**: BLE connection management
- **SamplerView.swift**: Signal sampling and replay
- **ConsoleView.swift**: Raw command interface
- **BadUSBView.swift**: USB HID emulation scripting
- **FirmwareUpdateView.swift**: OTA firmware updates

#### Utilities
- **JavaScriptEngine.swift**: Embedded JS engine for custom automation

### BLE Implementation

The iOS app uses CoreBluetooth to communicate with the EMWaver device. The BLEManager class handles:
- Device scanning and discovery
- Connection management
- Command sending and notification reception
- Data parsing and buffering

### JavaScript Automation

The iOS app includes a JavaScript automation system through the JavaScriptEngine class. This allows users to create custom scripts for device control and automation:

- Uses JavaScriptCore for native JavaScript execution
- Provides access to device functions via JavaScript APIs
- Exposes core functionalities to scripts:
  - BLE communication via `BLEService` object
  - CC1101 radio control via `CC1101` object with registers and commands
  - Utility functions via `Utils` object
- Supports script loading and module system
- Enables complex automation sequences and custom protocols

Example JavaScript capabilities:
```javascript
// Configure CC1101 for 433MHz
CC1101.strobe(CC1101.SRES);  // Reset
CC1101.writeRegister(CC1101.FREQ2, 0x10);  // Set frequency to 433MHz
CC1101.writeRegister(CC1101.FREQ1, 0xA7);
CC1101.writeRegister(CC1101.FREQ0, 0x62);
CC1101.setModulation(CC1101.MOD_ASK);  // ASK modulation
CC1101.setPower(CC1101.POWER_10_DBM);  // Maximum power

// Send custom data pattern
BLEService.sendCommand("transmit 4");  // Start transmitting on GPIO4
```

## 3. Android App Architecture (`android/`)

The Android app mirrors the iOS app's functionality with a native Java implementation.

### Structure

- **MainActivity.java**: Main activity and entry point
- **BLEService.java**: Core service for BLE communication
- **ui/**: Package containing UI components:
  - **ism/**: Sub-GHz RF controls
  - **rfid/**: RFID functionality
  - **badusb/**: USB HID emulation
  - **console/**: Raw command interface
  - **sampler/**: Signal sampling and analysis
  - **ble/**: BLE connection management
- **ir/**: Infrared protocol implementation

### BLE Implementation

The Android app implements BLE communication through the BLEService class, which:
- Runs as a foreground service with a notification
- Handles connection management and retry logic
- Provides methods for sending commands and receiving notifications
- Implements native buffering for efficient signal processing

## 4. Hardware Specifications

The EMWaver board features:

- **Microcontroller**: ESP32-S3 with built-in BLE
- **RF Transceiver**: CC1101 for sub-GHz communication (433/868/915 MHz)
- **Infrared**: IR LED and receiver for IR signal analysis and transmission
- **USB**: Male USB-C connector for direct smartphone connection
- **Expansion**: 16 GPIO pins for connecting external hardware
- **RFID**: Support for external MFRC522 RFID modules

### Pin Mapping

| Component | ESP32-S3 Pins |
|-----------|--------------|
| CC1101 MISO | GPIO13 |
| CC1101 MOSI | GPIO11 |
| CC1101 SCK | GPIO12 |
| CC1101 CS | GPIO10 |
| MFRC522 CS | GPIO9 |
| MFRC522 RST | GPIO7 |

## Communication Protocol

Communication between the apps and the device occurs via:

1. **Bluetooth Low Energy (BLE)**: Primary communication channel for control and data exchange
2. **USB**: Direct connection for firmware updates, BadUSB functionality

### BLE Command Structure

The EMWaver uses a text-based command protocol where commands are sent as ASCII strings. The first word in the command specifies the subsystem, followed by parameters:

#### Common Command Formats

1. **CC1101 Commands**:
   - `cc1101 reg <address> <value>`: Write a value to a CC1101 register
   - `cc1101 read <address>`: Read a value from a CC1101 register
   - `cc1101 strobe <value>`: Send a command strobe to the CC1101
   - `cc1101 burst <address> <data...>`: Write multiple values to consecutive CC1101 registers

2. **Sampling Commands**:
   - `sample <pin>`: Start sampling on the specified GPIO pin
   - `stop`: Stop the current sampling operation

3. **Transmission Commands**:
   - `transmit <pin>`: Start transmission on the specified GPIO pin
   - `stop`: Stop the current transmission

4. **RFID Commands**:
   - `rfid cmd <data...>`: Send a command to the RFID module
   - `rfid detect`: Scan for RFID cards
   - `rfid read <block>`: Read data from a specific block
   - `rfid write <block> <data...>`: Write data to a specific block

5. **BadUSB Commands**:
   - `usb STRING <text>`: Type the specified text
   - `usb DELAY <ms>`: Wait for the specified milliseconds
   - `usb ENTER`: Press the Enter key
   - `usb STRING_DELAY <ms>`: Set the delay between keystrokes

### Response Format

Responses from the device are sent via the notification characteristic and can be:
- Single-byte acknowledgments (0x01 for success)
- Multi-byte data packets for more complex responses
- Continuous data streams for sampling operations

## Signal Sampling and Transmission

EMWaver implements high-precision signal sampling and transmission capabilities:

### Sampling

- Utilizes hardware timer interrupts for precise 10μs sampling
- Dual-buffer approach (bufferA/bufferB) for continuous sampling
- Buffer swap mechanism for uninterrupted data collection
- BLE notifications for real-time data streaming to the mobile app

### Transmission

- Hardware timer-based signal generation with 10μs precision
- Bit-by-bit transmission for maximum accuracy
- Support for both BLE-streamed and buffer-based transmission
- Automatic timeout detection to prevent endless transmission

## Development Workflow

1. **Firmware Development**: 
   - Built with ESP-IDF framework
   - Compiled and flashed using standard ESP-IDF tools
   - OTA updates supported via mobile apps

2. **App Development**:
   - iOS: Xcode, Swift, SwiftUI
   - Android: Android Studio, Java

## Getting Started

1. **Hardware Setup**: Connect the EMWaver device to a USB port or directly to a smartphone
2. **BLE Connection**: Use the iOS or Android app to connect to the device via BLE
3. **Feature Selection**: Choose from the available features (RF, IR, RFID, etc.)

## Future Expansion

The modular design allows for extending the EMWaver platform with:
- Additional RF protocols
- Enhanced signal analysis capabilities
- Custom hardware add-ons via GPIO
- Advanced scripting and automation

## Performance Considerations

- **Sampling Rate**: Signal sampling occurs at 10μs precision (100kHz)
- **BLE Throughput**: Limited by BLE standard (~10KB/s)
- **Memory Constraints**: ESP32-S3 has limited RAM for buffer storage
- **Buffer Size**: Default sampling buffer is 256 bytes per buffer (512 bytes total)

## Conclusion

EMWaver provides a comprehensive framework for wireless experimentation and signal analysis. The integration of ESP32-S3, CC1101 RF transceiver, and RFID technology creates a versatile platform for exploring various wireless protocols. The dual-app approach ensures compatibility with both iOS and Android devices, while the JavaScript automation capabilities enable advanced scripting and customization. Through its modular design and well-documented communication protocol, EMWaver offers both beginners and experts a powerful tool for RF exploration, device control, and embedded systems development.

---

For more details, explore the links above. This documentation is designed to be simple and easy to navigate—everything you need is just a click away! 