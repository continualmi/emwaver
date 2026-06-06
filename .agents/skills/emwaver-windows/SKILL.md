---
name: emwaver-windows
description: Use when working on the EMWaver Windows 11 app, including WPF pages, USB and device services, board-aware firmware update flows, self-contained local runtime behavior, desktop MCP migration, or macOS parity work for local-first behavior.
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
- [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Services`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Services): transport, device lifecycle, firmware update, app services, and legacy cloud surfaces
- [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Scripting`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Scripting): script engine and plot/runtime support
- [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Assets/Firmware`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Assets/Firmware): packaged firmware assets

## Core behaviors to preserve

- Windows targets Windows 11 only.
- Windows is intended to track macOS parity for local device control and board-aware firmware updates.
- Local scripts, local device control, and firmware update flows must not require accounts, activation, hardware UID reads, minting, claiming, device limits, or hosted relay.
- STM32 and ESP32-S3 use different update paths; keep the app board-aware.
- Avoid Pro/account language in user-facing core UI. In-app Agent/MGPT inference is migration debt; desktop external-agent access should move to MCP.
- Treat `WindowsDeviceManager.cs` and `FirmwareUpdateManager.cs` as the first files for local transport/update issues.
- Treat `Services/Cloud/*` as legacy or Agent-key migration debt unless a task explicitly needs the optional Agent API boundary.

## Implementation cues

- `Services/UsbMidiSysex.cs` and `Services/WindowsDeviceManager.cs` are the main transport and device-state anchors.
- `Services/FirmwareUpdateManager.cs` and `Services/Dfu.cs` own update logic.
- `Services/Cloud` and `Services/Pro` are legacy/migration surfaces and should not be pulled into core local hardware control.
- `Pages/DevicePage*`, `Pages/HostsPage*`, and `Pages/RemoteHostControlPage*` are the main user-facing surfaces for device state and remote control.
- `Scripting/ScriptEngine.cs`, `Scripting/PlotBufferStore.cs`, and `Scripting/Render/ScriptRenderer.cs` are the core script-runtime entry points.
- `Services/Agent/*` is legacy Agent/MGPT migration debt; preserve useful primitive semantics for MCP.

## Common task routing

- Device state and local transport: [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Services/WindowsDeviceManager.cs`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Services/WindowsDeviceManager.cs)
- Firmware update flow: [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Services/FirmwareUpdateManager.cs`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Services/FirmwareUpdateManager.cs), [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Dialogs/FirmwareUpdateDialog.xaml.cs`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Dialogs/FirmwareUpdateDialog.xaml.cs)
- Agent/MGPT removal or MCP migration: [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Services/Agent`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Services/Agent), [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Scripting`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Scripting)
- Script UI/runtime bug: [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Scripting`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Scripting), [`/Users/luisml/continualmi/emwaver/windows/EMWaver/Pages/ScriptsPage.xaml.cs`](/Users/luisml/continualmi/emwaver/windows/EMWaver/Pages/ScriptsPage.xaml.cs)

## Validation posture

- Prefer compile-safe edits and Windows-specific project checks where available.
- Real validation still needs a Windows 11 workstation and both STM32 and ESP32-S3 hardware when update behavior changes.
