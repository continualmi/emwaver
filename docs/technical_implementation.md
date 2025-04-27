---
hide:
  - toc
---
# Technical Implementation

EMWaver is an open-source hardware platform and companion software suite for wireless experimentation, signal analysis, and device control. It features an ESP32-S3-based board with sub-GHz (CC1101), infrared, USB-C, and GPIO expansion, plus powerful mobile apps for iOS and Android.

## What is EMWaver?

EMWaver is designed for enthusiasts, makers, and researchers who want to:
- Experiment with sub-GHz and IR signals
- Control and automate devices via mobile apps
- Flash and update firmware easily
- Expand with custom hardware via GPIO

## Project Structure

- **Hardware:** ESP32-S3 board with CC1101, IR, USB-C, and GPIO
- **Firmware:** ESP-IDF-based, exposes BLE/USB APIs for mobile control
- **iOS/Android Apps:** Feature-rich UIs for all hardware functions
- **Documentation:** Simple, user-friendly, and all in one place

---

## Detailed Project Structure Overview

EMWaver is a self-contained repository for a powerful, open-source hardware platform and its companion software. The project is organized into four main components:

- **ESP32 Firmware** (root, `main/`)
- **iOS App** (`ios/`)
- **Android App** (`android/`)
- **Documentation** (`docs/`)

Below is a high-level overview of each component and their internal structure.

---

### 1. ESP32 Firmware (`main/`)

The firmware is the core logic running on the EMWaver hardware (ESP32-S3, CC1101, IR RX/TX, USB-C). It is located at the root in the `main/` folder and is built using ESP-IDF.

**Key files and modules:**
- `main.c`: Main entry point, hardware initialization, and application logic.
- `ble_server.c/h`: BLE server implementation for communication with mobile apps.
- `cc1101.c/h`: Driver for the CC1101 sub-GHz transceiver.
- `nrf24.c/h`: Driver for NRF24 wireless module (if present).
- `mfrc522.c/h`: Driver for MFRC522 RFID module.
- `badusb.c/h`: Implements BadUSB emulation features.
- `CMakeLists.txt`, `idf_component.yml`: Build configuration files.

**Purpose:**
- Handles all hardware interfaces (RF, IR, RFID, USB, GPIO).
- Exposes a BLE API for mobile apps to control and interact with the device.
- Implements advanced features like BadUSB, sub-GHz transmission, and RFID emulation.

---

### 2. iOS App (`ios/`)

The iOS app provides a user interface for controlling and interacting with the EMWaver hardware from an iPhone.

**Main structure:**
- `EMWaver/`: Main app source code
  - `Views/`: SwiftUI views for each hardware feature (e.g., `RFIDView.swift`, `ISMView.swift`, `ConsoleView.swift`, `BLEView.swift`, `FirmwareUpdateView.swift`, etc.)
  - `Managers/`: Service managers for BLE (`BLEManager.swift`), CC1101, and other hardware logic.
  - `ViewModels/`: View models for state management (e.g., `SamplerViewModel.swift`).
  - `JavaScriptEngine.swift`: Scripting support for advanced users.
  - `EMWaverApp.swift`, `ContentView.swift`: App entry points and main navigation.
- `EMWaver.xcodeproj/`: Xcode project files.
- `EMWaverTests/`, `EMWaverUITests/`: Unit and UI tests.

**Purpose:**
- Connects to the EMWaver device via BLE.
- Provides feature-rich UI for all hardware capabilities (RF, IR, RFID, BadUSB, etc.).
- Supports scripting and advanced device management.

---

### 3. Android App (`android/`)

The Android app mirrors the iOS app in functionality, providing a native interface for Android devices.

**Main structure:**
- `app/`: Main Android app module
  - `src/main/java/com/emwaver/emwaverandroidapp/`: Main package
    - `ui/`: UI components, organized by feature:
      - `rfid/`, `ism/`, `ghz24/`, `console/`, `sampler/`, `ble/`, `badusb/`, `buttons/`, `template/`, `firmware/`
    - `ir/`: Infrared encoding/decoding logic (`IRP.java`, `IrEncoder.java`)
    - `BLEService.java`: BLE communication service
    - `Utils.java`: Utility functions
    - `MainActivity.java`, `SettingsActivity.java`: App entry points
  - `res/`, `assets/`: Resources and assets
  - `AndroidManifest.xml`: App manifest
- `build.gradle`, `settings.gradle`, etc.: Build configuration

**Purpose:**
- Connects to EMWaver via BLE.
- Provides a modular UI for all hardware features.
- Implements IR, RF, RFID, and scripting support.

---

### 4. Documentation (`docs/`)

The `docs/` folder contains documentation for users and developers, built with MkDocs (Material theme).

- `index.md`: Project introduction and quickstart.
- `firmware.md`, `firmware/`: Firmware-specific documentation and resources.
- `context.md`: (This file) High-level project structure overview.
- `mkdocs.yml`: MkDocs configuration.

---

### Summary Table

| Folder         | Purpose                                      |
|----------------|----------------------------------------------|
| `main/`        | ESP32 firmware source code                   |
| `ios/`         | iOS app (SwiftUI, BLE, feature UIs)          |
| `android/`     | Android app (Java, BLE, feature UIs)         |
| `docs/`        | Documentation (MkDocs static site)           |

---

### Notes
- The repository is fully self-contained: all firmware, mobile apps, and documentation are included.
- The firmware is the most critical component, as it exposes all hardware features to the mobile apps via BLE.
- Both mobile apps are modular, with each hardware feature implemented as a separate UI module/view.
- The documentation site provides further details for users and developers.

For more details, see the README or the documentation in the `docs/` folder.

---

## Table of Contents
- [Overview](#overview)
- [Hardware](#hardware)
- [Firmware](#firmware)
- [iOS App](#ios-app)
- [Android App](#android-app)

---

## Hardware
Details about the EMWaver board, components (ESP32-S3, CC1101, IR, USB-C, GPIO), and hardware features.

---

## Firmware
Architecture, main modules, BLE/USB communication, and how the firmware interacts with the hardware and apps.

---

## iOS App
Features, user interface, how to connect to EMWaver, and iOS-specific notes.

---

## Android App
Features, user interface, how to connect to EMWaver, and Android-specific notes.

---

More details coming soon. 