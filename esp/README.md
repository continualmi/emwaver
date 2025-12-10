# EMWaver ESP32-S3 Firmware

This directory contains the ESP32-S3 firmware implementation using ESP-IDF.

## Structure

- `main/` - Main application code (moved from root `main/` folder)
- `CMakeLists.txt` - ESP-IDF project CMake configuration
- `sdkconfig` - ESP-IDF configuration file
- `sdkconfig.ci` - CI configuration file
- `dependencies.lock` - Component dependencies lock file
- `setup.sh` - ESP-IDF environment setup script

## Building

```bash
cd esp
source setup.sh
idf.py set-target esp32s3
idf.py build
idf.py -p /dev/ttyACM0 flash
idf.py monitor
```

## Communication

- **Protocol**: Bluetooth Low Energy (BLE) via NimBLE
- **Service UUID**: `45c7158e-0c3b-4e90-a847-452a15b14191`
- **Command Characteristic**: `46c7158e-0c3b-4e90-a847-452a15b14191`
- **Notification Characteristic**: `47c7158e-0c3b-4e90-a847-452a15b14191`

## Features

- BLE server with GATT characteristics
- Command registry system
- SPI support
- Sampler functionality
- MFRC522 RFID library support
