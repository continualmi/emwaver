---
title: ESP32-S3 Firmware (ESP-IDF)
---

# ESP32-S3 Firmware (ESP-IDF)

The ESP32-S3 firmware lives in `esp/` and is built with Espressif’s ESP-IDF.

## Devices (ESP32 Family)

This firmware applies to EMWaver devices built around the **ESP32-S3**, including:

- **EMWaver Flagship**
- **EMWaver Shield**
- **EMWaver DIY**
- Any ESP32-S3 development board running the EMWaver firmware

## Project Structure

| Path | Purpose |
| --- | --- |
| `esp/main/` | Core application code (BLE transport, command registry, drivers) |
| `esp/setup.sh` | Convenience script to load ESP-IDF into your shell |
| `esp/sdkconfig*` | ESP-IDF configuration (including CI config) |

## Build & Flash (High Level)

From `esp/`:

```bash
source setup.sh
idf.py set-target esp32s3
idf.py build
idf.py -p <PORT> flash
idf.py -p <PORT> monitor
```

Ports are typically:
- Linux: `/dev/ttyACM0` or `/dev/ttyUSB0`
- macOS: `/dev/cu.usbmodem*` or `/dev/cu.wchusbserial*`
- Windows: `COMx` (or use WSL)

For the full step-by-step guide (including ESP-IDF installation and WSL USB forwarding), see the **Flashing Firmware → ESP32 (ESP32‑S3)** page.

## Communication (BLE)

The ESP32 firmware exposes a custom BLE service:

- **Service UUID**: `45c7158e-0c3b-4e90-a847-452a15b14191`
- **Command characteristic (write)**: `46c7158e-0c3b-4e90-a847-452a15b14191`
- **Notification characteristic (notify)**: `47c7158e-0c3b-4e90-a847-452a15b14191`

The higher-level command protocol is documented in [Transport & Command Format](protocol.md).

