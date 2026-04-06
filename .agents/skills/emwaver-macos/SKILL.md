---
name: emwaver-macos
description: Use when working on the native EMWaver macOS app, especially host management, firmware provisioning, board-aware update flows, Continual sign-in handoff, Pro entitlements, or the boundary between /macos and the shared /apple package.
---

# EMWaver macOS

Use this skill for work under [`/Users/luisml/continualmi/emwaver/macos`](/Users/luisml/continualmi/emwaver/macos).

## Read first

1. [`/Users/luisml/continualmi/emwaver/macos/README.md`](/Users/luisml/continualmi/emwaver/macos/README.md)
2. [`/Users/luisml/continualmi/emwaver/apple/README.md`](/Users/luisml/continualmi/emwaver/apple/README.md) when shared Apple code may be involved
3. [`/Users/luisml/continualmi/emwaver/AGENTS.md`](/Users/luisml/continualmi/emwaver/AGENTS.md)

## Where things live

- [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/EMWaverApp.swift`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/EMWaverApp.swift) and [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/ContentView.swift`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/ContentView.swift): app entry and shell
- [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/Auth`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/Auth): auth managers and handoff UI
- [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/Pro`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/Pro): entitlements and upgrade UX
- [`/Users/luisml/continualmi/emwaver/macos/EMWaver/Tools`](/Users/luisml/continualmi/emwaver/macos/EMWaver/Tools): helper binaries and helper docs
- [`/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore`](/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore): reusable Apple logic

## Core behaviors to preserve

- macOS is the canonical desktop activation and provisioning surface on Apple platforms.
- Device registration is keyed by `board_type + hardware_uid`.
- Sign-in must remain available before a device is connected.
- macOS auth flows should align with EMWaver-owned sign-in UX and the shared `continual-core` account/billing contract, not a Society-owned runtime handoff service.
- STM32 and ESP32-S3 have different update flows. Do not collapse them into one transport or one helper path.
- `Continual Pro` is the canonical paid plan language.
- `MacUSBManager.swift`, `AccountDevicesService.swift`, `FirmwareUpdateManager.swift`, and `DeviceConnectionSheet.swift` are the first files to inspect for activation and provisioning work.
- `HostSessionManager.swift`, `HostDirectory.swift`, and `RemoteControl*` are the first files to inspect for host presence and remote control work.

## Board-specific rules

- STM32: run mode over USB, managed DFU flow for update/provisioning.
- ESP32-S3: run mode over USB, flashing over the flash-capable serial port, with BOOT/RESET guidance when needed.
- Do not bundle `idf.py` or assume the macOS app should own full ESP-IDF developer workflows.

## Common task routing

- Sign-in or session-restore bug: [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/Auth/AuthenticationManager.swift`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/Auth/AuthenticationManager.swift)
- Device claim, offline cache, or restore issue: [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/AccountDevicesService.swift`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/AccountDevicesService.swift)
- Firmware update behavior: [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/FirmwareUpdateManager.swift`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/FirmwareUpdateManager.swift), [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/FirmwareUpdateSheet.swift`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/FirmwareUpdateSheet.swift)
- Host and remote control behavior: [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/HostSessionManager.swift`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/HostSessionManager.swift), [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/RemoteHostControlView.swift`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/RemoteHostControlView.swift)
- Shared Apple runtime or script UI change: [`/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore/Sources`](/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore/Sources)

## Validation posture

- Prefer code review plus focused Xcode validation on macOS when available.
- Native build and hardware tests may require a real Apple workstation and real boards; call out when validation is partial.
