---
name: emwaver-macos
description: Use when working on the native EMWaver macOS app, especially self-contained local runtime behavior, board-aware update flows, desktop MCP migration, or the boundary between /macos and the shared /apple package.
---

# EMWaver macOS

Use this skill for work under [`/Users/luisml/continualmi/emwaver/macos`](/Users/luisml/continualmi/emwaver/macos).

## Read first

1. [`/Users/luisml/continualmi/emwaver/macos/README.md`](/Users/luisml/continualmi/emwaver/macos/README.md)
2. [`/Users/luisml/continualmi/emwaver/apple/README.md`](/Users/luisml/continualmi/emwaver/apple/README.md) when shared Apple code may be involved
3. [`/Users/luisml/continualmi/emwaver/AGENTS.md`](/Users/luisml/continualmi/emwaver/AGENTS.md)

## Where things live

- [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/EMWaverApp.swift`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/EMWaverApp.swift) and [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/ContentView.swift`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/ContentView.swift): app entry and shell
- [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/Auth`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/Auth): legacy Agent API key/session helpers targeted for removal
- [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/Pro`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/Pro): legacy entitlement/upgrade surfaces being retired from core UI
- [`/Users/luisml/continualmi/emwaver/macos/EMWaver/Tools`](/Users/luisml/continualmi/emwaver/macos/EMWaver/Tools): helper binaries and helper docs
- [`/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore`](/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore): reusable Apple logic

## Core behaviors to preserve

- macOS is a local-first desktop app with its own self-contained native runtime.
- Local scripts, local device control, and firmware update flows must not require accounts, activation, hardware UID reads, minting, claiming, device limits, or hosted relay.
- In-app Agent API key UI/runtime is migration debt; desktop external-agent access should move to local MCP.
- Avoid user-facing product-strategy wording; app UI should be neutral and local-first.
- STM32 and ESP32-S3 have different update flows. Do not collapse them into one transport or one helper path.
- `MacUSBManager.swift`, `FirmwareUpdateManager.swift`, and `DeviceConnectionSheet.swift` are the first files to inspect for local transport and update behavior.
- `HostSessionManager.swift`, `HostDirectory.swift`, and `RemoteControl*` are legacy host-control surfaces to avoid reintroducing into the core local path.

## Board-specific rules

- STM32: run mode over USB, managed DFU flow for local firmware update.
- ESP32-S3: run mode over USB, flashing over the flash-capable serial port, with BOOT/RESET guidance when needed.
- Do not bundle `idf.py` or assume the macOS app should own full ESP-IDF developer workflows.

## Common task routing

- Agent removal or MCP migration: start from [`/Users/luisml/continualmi/emwaver/docs/AGENT_TO_MCP_MIGRATION.html`](/Users/luisml/continualmi/emwaver/docs/AGENT_TO_MCP_MIGRATION.html), then inspect the macOS script runtime and transport managers.
- Firmware update behavior: [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/FirmwareUpdateManager.swift`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/FirmwareUpdateManager.swift), [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/FirmwareUpdateSheet.swift`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/FirmwareUpdateSheet.swift)
- Host and remote control behavior: [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/HostSessionManager.swift`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/HostSessionManager.swift), [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/RemoteHostControlView.swift`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver/RemoteHostControlView.swift)
- Shared Apple runtime or script UI change: [`/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore/Sources`](/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore/Sources)

## Validation posture

- Prefer code review plus focused Xcode validation on macOS when available.
- Native build and hardware tests may require a real Apple workstation and real boards; call out when validation is partial.
