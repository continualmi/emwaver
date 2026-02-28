# EMWaver Windows App (`/windows`)

Native Windows desktop app (WinUI 3 / Windows App SDK) for EMWaver.

Target: Windows 11 only.

---

## 1) Scope

This folder contains the full Windows client:
- USB MIDI transport integration,
- script runtime UI and tooling pages,
- remote host/session control views,
- firmware update flow integration,
- cloud/auth/account surfaces.

Project files:
- solution: `windows/EMWaver.sln`
- app project: `windows/EMWaver/EMWaver.csproj`

---

## 2) App architecture overview

Primary app shell:
- `Program.cs`
- `App.xaml` / `App.xaml.cs`
- `MainWindow.xaml` / `MainWindow.xaml.cs`

UI pages:
- `Pages/ScriptsPage*`
- `Pages/DevicePage*`
- `Pages/SettingsPage*`
- `Pages/HostsPage*`
- `Pages/RemoteHostControlPage*`

Core service layer:
- `Services/UsbMidiSysex.cs` (device transport)
- `Services/WindowsDeviceManager.cs` (device lifecycle)
- `Services/ScriptRepository.cs` (script storage)
- `Services/FirmwareUpdateManager.cs` + `Services/Dfu.cs` (firmware/update)
- `Services/AppSettings.cs` / `Services/AppServices.cs`

Scripting/runtime:
- `Scripting/ScriptEngine.cs`
- `Scripting/ScriptModel.cs`
- `Scripting/PlotBufferStore.cs`

Auxiliary:
- `Dialogs/*`
- `Converters/*`
- `Models/*`

---

## 3) Runtime capabilities

## 3.1 Device connection and transport

Windows app communicates with EMWaver hardware over USB MIDI SysEx and hosts device operations from the desktop runtime.

Transport logic lives under `Services/UsbMidiSysex.cs` and related device manager services.

## 3.2 Scripting UX

Scripts UI and runtime behavior are centered in `ScriptsPage` and `Scripting/*` modules, including plot/state helpers and script document handling.

## 3.3 Remote host control

Remote control pages/services provide host listing and attach/control behavior for cloud-connected hosts:
- `Pages/HostsPage*`
- `Pages/RemoteHostControlPage*`

## 3.4 Firmware update path

Firmware update dialogs/managers are present:
- `Dialogs/FirmwareUpdateDialog*`
- `Services/FirmwareUpdateManager.cs`
- `Services/Dfu.cs`

Bundled firmware assets live under `Assets/Firmware` (updated via repo tooling).

## 3.5 App settings and appearance

Settings surface includes app-level preferences such as:
- appearance mode (`System`, `Light`, `Dark`),
- staff-only backend/frontend environment switching.

---

## 4) Interop note

`Interop/NativeBufferRust.cs` exists, but AGENTS guidance marks legacy Rust buffer-core dependency as removed from product-critical path.

Treat any Rust interop usage here as transitional/legacy unless explicitly re-validated.

---

## 5) Build environment (Windows dev machine)

Required:
- Windows 11
- Visual Studio 2022
  - .NET desktop workload
  - Windows App SDK / WinUI 3 tooling
- .NET SDK 8.x

Open `EMWaver.sln` in Visual Studio for build/run/debug.

---

## 6) Repository guardrail for this folder

Per repo guidance: in this agent environment, avoid running full Windows builds automatically due to file-lock/permission instability.

Expected workflow:
- edit code/docs,
- commit/push,
- validate build/run on a Windows workstation.

---

## 7) Documentation maintenance rule

When changing page structure or service responsibilities in Windows app:
- update this README in the same PR,
- include any protocol-impact changes also in backend/daemon/frontend docs where relevant.
