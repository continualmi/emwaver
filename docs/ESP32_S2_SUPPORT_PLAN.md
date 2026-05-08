# ESP32-S2 USB and Wi-Fi Support Plan

## Summary

ESP32-S2 support should reuse the existing ESP-IDF firmware workspace instead of duplicating ESP firmware. ESP32-S2 is a USB and Wi-Fi target only; it has no BLE radio. ESP32-S3 remains the ESP target for USB, BLE, and Wi-Fi.

## Implementation Shape

- Keep one shared EMWaver ESP protocol/runtime implementation under `esp/`.
- Compile BLE sources only for BLE-capable targets such as ESP32-S3.
- Compile a no-op BLE shim for ESP32-S2 so shared command-response code can stay transport-neutral.
- Report target-aware board metadata:
  - ESP32-S2: `board=esp32s2`, `cap=wifi,usb`
  - ESP32-S3: `board=esp32s3`, `cap=wifi,usb,ble`
- Keep USB, Wi-Fi provisioning, Wi-Fi WebSocket auth, and command/superframe behavior shared between ESP32-S2 and ESP32-S3.

## Build Targets

Internal firmware developers can build either ESP target from the same workspace:

```bash
idf.py set-target esp32s2 build
idf.py set-target esp32s3 build
```

End users should still receive managed firmware through EMWaver tooling rather than building or flashing manually.

## Validation

- ESP32-S2 build succeeds without BLE/NimBLE components.
- ESP32-S3 build still includes BLE/NimBLE components.
- ESP32-S2 enumerates over USB and responds to standard EMWaver command frames.
- ESP32-S2 can be provisioned for Wi-Fi over USB.
- ESP32-S2 advertises `_emwaver._tcp` with `board=esp32s2` and `cap=wifi,usb`.
- ESP32-S3 regression check confirms `board=esp32s3` and `cap=wifi,usb,ble`.

## Assumptions

- First ESP32-S2 support targets one known dev board before broad S2 compatibility is claimed.
- Pin defaults remain board-profile work and should be audited against the chosen ESP32-S2 board.
- No app-level protocol fork is introduced for ESP32-S2.
