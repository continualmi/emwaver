---
name: emwaver-macos
description: Use when working on the native EMWaver macOS app, especially local gateway app-role control, host management, board-aware update flows, Agent API key UI, or the boundary between /macos and the shared /apple package.
---

# EMWaver macOS

Use this skill for work under [`/Users/luisml/continualmi/emwaver/macos`](/Users/luisml/continualmi/emwaver/macos).

## Read first

1. [`/Users/luisml/continualmi/emwaver/macos/README.md`](/Users/luisml/continualmi/emwaver/macos/README.md)
2. [`/Users/luisml/continualmi/emwaver/apple/README.md`](/Users/luisml/continualmi/emwaver/apple/README.md) when shared Apple code may be involved
3. [`/Users/luisml/continualmi/emwaver/AGENTS.md`](/Users/luisml/continualmi/emwaver/AGENTS.md)

## Where things live

- [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/EMWaverApp.swift`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/EMWaverApp.swift) and [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/ContentView.swift`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/ContentView.swift): app entry and shell
- [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/Auth`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/Auth): transitional Agent API key/session helpers
- [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/Pro`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/Pro): legacy entitlement/upgrade surfaces being retired from core UI
- [`/Users/luisml/continualmi/emwaver/macos/EMWaver/Tools`](/Users/luisml/continualmi/emwaver/macos/EMWaver/Tools): helper binaries and helper docs
- [`/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore`](/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore): reusable Apple logic

## Core behaviors to preserve

- macOS is a local-first desktop app and localhost gateway app-role target.
- Local scripts, local device control, and firmware update flows must not require accounts, activation, hardware UID reads, minting, claiming, device limits, or hosted relay.
- Agent API key entry may remain available before a device is connected, but it is only for optional Agent inference.
- Avoid user-facing product-strategy wording; app UI should be neutral and local-first.
- STM32 and ESP32-S3 have different update flows. Do not collapse them into one transport or one helper path.
- `MacUSBManager.swift`, `FirmwareUpdateManager.swift`, and `DeviceConnectionSheet.swift` are the first files to inspect for local transport and update behavior.
- `HostSessionManager.swift`, `HostDirectory.swift`, and `RemoteControl*` are the first files to inspect for local gateway/app-role control or legacy hosted host behavior.

## Board-specific rules

- STM32: run mode over USB, managed DFU flow for local firmware update.
- ESP32-S3: run mode over USB, flashing over the flash-capable serial port, with BOOT/RESET guidance when needed.
- Do not bundle `idf.py` or assume the macOS app should own full ESP-IDF developer workflows.

## Common task routing

- Agent API key/session helper bug: [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/Auth/AuthenticationManager.swift`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/Auth/AuthenticationManager.swift)
- Firmware update behavior: [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/FirmwareUpdateManager.swift`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/FirmwareUpdateManager.swift), [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/FirmwareUpdateSheet.swift`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/FirmwareUpdateSheet.swift)
- Host and remote control behavior: [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/HostSessionManager.swift`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/HostSessionManager.swift), [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/RemoteHostControlView.swift`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/RemoteHostControlView.swift)
- Shared Apple runtime or script UI change: [`/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore/Sources`](/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore/Sources)

## Validation posture

- Prefer code review plus focused Xcode validation on macOS when available.
- Native build and hardware tests may require a real Apple workstation and real boards; call out when validation is partial.
