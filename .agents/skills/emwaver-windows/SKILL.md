---
name: emwaver-windows
description: Use when working on the EMWaver Windows 11 app, including WinUI pages, USB and device services, board-aware firmware update flows, cloud/auth/account surfaces, or macOS parity work for activation and provisioning behavior.
---

# EMWaver Windows

Use this skill for work under [`/Users/luisml/continualmi/emwaver/windows`](/Users/luisml/continualmi/emwaver/windows).

## Read first

1. [`/Users/luisml/continualmi/emwaver/windows/README.md`](/Users/luisml/continualmi/emwaver/windows/README.md)
2. [`/Users/luisml/continualmi/emwaver/macos/README.md`](/Users/luisml/continualmi/emwaver/macos/README.md) if the task is parity-driven
3. [`/Users/luisml/continualmi/emwaver/AGENTS.md`](/Users/luisml/continualmi/emwaver/AGENTS.md)

## Where things live

- [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Program.cs`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Program.cs), [`/Users/luisml/continualmi/emwaver/windows/EMWaver/App.xaml`](/Users/luisml/continualmi/emwaver/windows/EMWaver/App.xaml), and [`/Users/luisml/continualmi/emwaver/windows/EMWaver/MainWindow.xaml`](/Users/luisml/continualmi/emwaver/windows/EMWaver/MainWindow.xaml): app entry and shell
- [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Pages`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Pages): main UI pages
- [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Dialogs`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Dialogs): dialog surfaces including firmware flows
- [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Services`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Services): transport, device lifecycle, firmware update, app services, cloud and Pro services
- [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Scripting`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Scripting): script engine and plot/runtime support
- [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Assets/Firmware`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Assets/Firmware): packaged firmware assets

## Core behaviors to preserve

- Windows targets Windows 11 only.
- Activation and restore are keyed by `board_type + hardware_uid`.
- Windows is intended to track macOS parity for claim, provision, update, offline cache, and entitlement behavior.
- STM32 and ESP32-S3 use different update paths; keep the app board-aware.
- Use `Continual Pro` as canonical paid-plan language.
- Treat `AccountDevicesService.cs`, `WindowsDeviceManager.cs`, and `FirmwareUpdateManager.cs` as the first files for activation/provisioning issues.
- Treat `Services/Cloud/*` as the first place for auth, host session, and remote control issues.

## Implementation cues

- `Services/UsbMidiSysex.cs` and `Services/WindowsDeviceManager.cs` are the main transport and device-state anchors.
- `Services/FirmwareUpdateManager.cs` and `Services/Dfu.cs` own update logic.
- `Services/Cloud` and `Services/Pro` handle account and entitlement plumbing.
- `Pages/DevicePage*`, `Pages/HostsPage*`, and `Pages/RemoteHostControlPage*` are the main user-facing surfaces for device state and remote control.
- `Scripting/ScriptEngine.cs`, `Scripting/PlotBufferStore.cs`, and `Scripting/Render/ScriptRenderer.cs` are the core script-runtime entry points.
- `Services/Agent/AgentApi.cs` is the native app bridge into backend-managed agent routes.

## Common task routing

- Device state, claim, and offline cache: [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Services/WindowsDeviceManager.cs`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Services/WindowsDeviceManager.cs), [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Services/AccountDevicesService.cs`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Services/AccountDevicesService.cs)
- Firmware update flow: [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Services/FirmwareUpdateManager.cs`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Services/FirmwareUpdateManager.cs), [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Dialogs/FirmwareUpdateDialog.xaml.cs`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Dialogs/FirmwareUpdateDialog.xaml.cs)
- Cloud sign-in or remote host control: [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Services/Cloud`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Services/Cloud)
- Script UI/runtime bug: [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Scripting`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Scripting), [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Pages/ScriptsPage.xaml.cs`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Pages/ScriptsPage.xaml.cs)

## Validation posture

- Prefer compile-safe edits and Windows-specific project checks where available.
- Real validation still needs a Windows 11 workstation and both STM32 and ESP32-S3 hardware when update behavior changes.
