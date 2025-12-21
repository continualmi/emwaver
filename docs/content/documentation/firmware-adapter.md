---
title: BLE Adapter Firmware (USB↔BLE)
---

# BLE Adapter Firmware (USB↔BLE)

The BLE adapter firmware lives in `adapter/` and targets an ESP32-S3 “BLE Waver Dongle”.

## What It Does

It bridges:

- **USB CDC-ACM** (to a host / serial device)
- **BLE** (to a phone/desktop client)

Data flow:

- Client → dongle: BLE write → forwarded to USB TX
- USB RX → dongle: forwarded to BLE notify

## BLE Interface

- **Service UUID**: `45c7158e-0c3b-4e90-a847-452a15b14191`
- **Characteristic UUID**: `46c7158e-0c3b-4e90-a847-452a15b14191`

## Build & Flash (ESP-IDF)

```bash
cd adapter
idf.py set-target esp32s3
idf.py build
idf.py -p <PORT> flash monitor
```

Configuration is available via `idf.py menuconfig` → `Adapter Configuration`.

