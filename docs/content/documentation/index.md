---
title: Documentation
---

# Documentation

This section is the technical reference for the open-source EMWaver project (firmware, apps, CLI, and protocols).

## Quick Links

- [Repository Layout](repository-layout.md)
- Firmware
  - [ESP32-S3 (ESP-IDF)](firmware-esp32.md)
  - [STM32F042 (STM32CubeIDE)](firmware-stm32.md)
- [Transport & Command Format](protocol.md)
- [CLI](cli.md)
- Apps
  - [Apps Overview](apps.md)
  - [App UI (Fragments)](../documentation.md)

## What This Repo Contains

EMWaver is a multi-target project:

- **ESP32-S3 firmware** (ESP-IDF) for the “ESP32 family” devices
- **STM32F042 firmware** (STM32CubeIDE/CubeMX) for the “STM32 family” devices
- **CLI** (Rust) for initializing projects and interacting with devices
- **Android / iOS companion apps**
- **Desktop app** (Tauri) mirroring mobile features
- **MkDocs documentation** (this site)

If you’re new and just want to flash a device, start with the **Flashing Firmware** tab.

## Stack Overview (In Depth)

The EMWaver stack spans firmware, transports, clients, and the Wavelet runtime:

### Firmware (ESP32-S3)

- **Entry point**: `esp/main/init.c` initializes the command registry, SPI/GPIO/sampler/USB/radio drivers, and BLE server.
- **Command registry**: `esp/main/command_registry.c` parses ASCII commands, dispatches handlers, and sends raw response bytes over BLE.
- **Transport**: `esp/main/ble_server.c` exposes the custom BLE service + characteristics for command write and notify responses.
- **Device drivers**:
  - SPI bus + device registry: `esp/main/spi.c`
  - GPIO helpers: `esp/main/gpio_commands.c`
  - Sampler + transmit PWM: `esp/main/sampler.c`
  - USB HID (BadUSB-style): `esp/main/usb.c`
  - Sub-GHz radios: `esp/main/cc1101.c`, `esp/main/rfm69.c`

### Firmware (STM32F042)

- **Projects**: `stm/emwaver-gpio-firmware/`, `stm/emwaver-ir-firmware/`, `stm/emwaver-ism-firmware/`, `stm/emwaver-rfid-firmware/` (CubeIDE projects + `.ioc` configs).
- **Transport**: USB CDC virtual serial (115200) using the same ASCII command protocol.

### Client Surfaces

- **Android/iOS apps**: Pair over BLE/USB, render wavelets, and surface the command protocol behind UI fragments.
- **Desktop app**: Local Git repo editor + wavelet preview, mirroring mobile feature parity.
- **CLI**: `emwaver shell` provides an interactive prompt that sends commands and formats raw responses.

### Wavelet Runtime

- **Wavelets**: JavaScript bundles using the EMWaver DSL to declare UI and call device APIs.
- **Sync**: Git/GitHub as the source of truth; mobile Git fragment and desktop editor manage clone/pull/push.
