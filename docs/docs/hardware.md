---
title: Hardware
---

# EMWaver Hardware

The EMWaver board combines the ESP32-S3 with dedicated RF, infrared, and USB subsystems so you can prototype wireless workflows without stacking shields or breakout boards. This page highlights each hardware block and how it supports Wavelet-driven applications.

## Core Controller: ESP32-S3

- Dual-core Tensilica LX7 MCU running up to 240 MHz with 2.4 GHz Wi-Fi and Bluetooth LE connectivity.
- Integrated USB OTG peripheral mapped to the on-board USB-C male connector for device emulation, HID payloads, and smartphone-powered operation.
- Abundant GPIO, I2C, SPI, UART, and PWM peripherals exposed through the expansion headers.
- Secure boot, flash encryption, and rich interrupt support for real-time signal work.

## Sub-GHz Radio: CC1101

- TI CC1101 transceiver dedicated to sub-GHz experimentation (315/433/868/915 MHz bands).
- Hardware-backed modulation profiles (ASK/OOK, 2-FSK, GFSK, MSK) tunable from Wavelets and the ISM fragment.
- Configurable data rates up to 600 kbps with adjustable output power stages.
- Dedicated GDO pins routed to GPIO headers for custom trigger logic or external analyzers.

## Infrared Subsystem

- Wide-angle IR blaster with high-current driver for reliable remote emulation.
- Sensitive IR receiver path tuned for 38 kHz carriers but capable of raw capture for arbitrary protocols.
- Wavelet APIs surface learn/transmit flows; sampled payloads can be promoted to IRDB-compatible bundles.

## 433 MHz Antenna

- Removable monopole tuned for 433.92 MHz mounted via U.FL to SMA pigtail.
- Supports swapping to region-specific antennas when operating in other ISM bands.
- Ground plane coupling optimized for handheld operation; ensure quarter-wave clearance when capturing signals.

## Dual USB Ports

| Connector | Role | Notes |
| --- | --- | --- |
| USB-C male | Direct to ESP32-S3 USB OTG | Powers the board from a smartphone or USB battery and enables native USB device emulation (HID, CDC, MSC) driven by Wavelets or firmware. |
| USB-C female | USB-to-serial bridge | Presents the traditional UART flashing path for firmware updates and debugging from a desktop IDE. Also supplies 5 V power when connected to a host. |

## Expansion Headers

- **1×8 header** (single-row) exposing primary GPIO for quick sensor or button attachments.
- **2×4 header** (dual-row) providing additional power rails, CC1101 GDO lines, and spare GPIO for modular add-ons.
- Both headers are 2.54 mm pitch for breadboard jumpers; reference the silkscreen or schematic to map functions before wiring external peripherals.

## Summary of On-Board Amenities

- ESP32-S3 MCU with Wi-Fi, BLE, and USB OTG
- CC1101 sub-GHz radio front-end
- Infrared receiver and high-power emitter
- 433 MHz monopole antenna interface
- USB-C male port for device emulation and mobile power
- USB-C female port for UART programming and desktop power
- Dual expansion headers (1×8, 2×4) for customization

Pair these hardware capabilities with Wavelets and the EMWaver DSL to script RF experiments, infrared remotes, or USB automation without designing a custom PCB.
