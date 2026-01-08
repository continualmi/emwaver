---
title: Firmware Update
---

# Firmware Update

EMWaver ships firmware **as a binary** and updates it **from the EMWaver app**.

## Update flow (recommended)

- **Desktop (computer)**: connect the device over USB, then use the app’s firmware update flow.
- **Android**: connect the device over USB (OTG), then use the app’s firmware update flow.

The app handles picking the correct firmware and applying it safely.

## Notes

- EMWaver is **USB-only** on STM32 (USB MIDI SysEx, 64-byte framing).
- If you’re doing firmware development/manufacturing, DFU/manual flashing still exists as an internal workflow, but it’s not the normal end-user path.
