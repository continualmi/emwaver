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
  - [BLE Adapter (USB↔BLE)](firmware-adapter.md)
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

