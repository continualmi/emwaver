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

The current packaged Windows firmware payload is copied from the repo root firmware bundle at build time:
- `../../firmware/emwaver.bin` -> app output `emwaver.bin`

Windows now follows the same board-class split as macOS:
- STM32 boards use the managed DFU update / claim flow.
- ESP32-S3 boards use the bundled serial flashing helper plus bundled ESP images.
- Windows setup/update UI is board-aware and can claim devices before flashing when needed.

## 3.5 App settings and appearance

Settings surface includes app-level preferences such as:
- appearance mode (`System`, `Light`, `Dark`),
- staff-only backend/frontend environment switching.

## 3.6 Current parity status vs macOS

Windows is intended to track the current macOS app in the device activation / provisioning layer.

What Windows already has:
- USB MIDI run-mode transport,
- secure identity verification in Run Mode using the embedded root key,
- STM32 DFU firmware flashing,
- cloud sign-in, host session, remote control, and Pro entitlement plumbing.

Windows now includes:
- board-aware device state (`board_type`, hardware UID, last detected board info),
- backend-tethered claim / restore flow using `/provisioning/mint`,
- device attach / seen flow using `/v1/devices/seen`,
- cached claimed-device list with offline-mode fallback,
- board-specific update UX split between STM32 DFU and ESP32-S3 serial flashing,
- bundled ESP32-S3 flashing helper + bundled ESP images when present in the workspace/build output,
- ESP bootloader detection and BOOT / RESET guidance,
- verification and activity-log surfaces around setup and update.

---

## 4) Historical Windows gaps now addressed

The parity work in this folder specifically addressed the older Windows gaps relative to macOS:

1. Device model
- `Services/WindowsDeviceManager.cs` now tracks hardware UID, connected board type, last detected board type, last detected hardware UID, and attach status in addition to version and secure identity.

2. Update architecture
- `Services/FirmwareUpdateManager.cs` now splits STM32 managed DFU from ESP32-S3 serial flashing.
- STM32 claim/update can mint identities and restore the identity page after flashing.
- ESP32-S3 setup/update uses the bundled helper + bundled image set when present.

3. Device UI / wording
- `Pages/DevicePage*` and `Dialogs/FirmwareUpdateDialog*` are now board-aware and expose claimed/cached/unclaimed state, offline messaging, verification, and activity logs.

4. Account / claim integration
- Windows now has local services equivalent to macOS `DeviceRegistryService` and `AccountDevicesService`.
- Genuine connected devices are seen/attached through the backend and claimed devices are cached locally for offline-aware behavior.

5. ESP32-S3 support
- Windows now detects ESP bootloader availability, resolves flash-capable serial ports, and guides the user toward the serial flashing path instead of forcing STM32 DFU semantics onto ESP boards.

6. Verification and operator diagnostics
- Windows now exposes Run Mode / Update Mode verification hooks plus flashing and provisioning activity logs.

---

## 5) Full parity target

To bring Windows to feature parity with the current macOS implementation, Windows should reach the following behavior:

### 5.1 Device state and transport

Windows should:
- read hardware UID in Run Mode using the shared device opcode,
- infer / store current board type and last detected board type,
- preserve last detected hardware UID for ESP and reconnect scenarios,
- keep the current secure Run Mode identity verification behavior.

### 5.2 Claim / restore / attach

Windows should:
- call `/provisioning/mint` with `board_type + hardware_uid` during setup,
- attach genuine connected devices through `/v1/devices/seen`,
- maintain a local claimed-device cache keyed by `board_type + hardware_uid`,
- support offline-mode access decisions from the cached device list.

### 5.3 STM32 update flow

Windows STM32 flow should match the current managed model:
- secured devices update through DFU,
- unclaimed STM32 boards can be claimed and provisioned from the app,
- device identity preservation / restore remains part of the managed flow,
- update UI clearly distinguishes claimed/setup vs update behavior.

### 5.4 ESP32-S3 update flow

Windows ESP flow should match the macOS board-class split:
- Run Mode remains USB MIDI SysEx,
- flashing uses the board's flash-capable serial USB port,
- the app bundles and invokes the ESP helper rather than `idf.py`,
- the app bundles prebuilt ESP firmware artifacts,
- the user is guided through BOOT / RESET entry when required,
- the app detects or helps choose the correct serial port,
- the device returns to Run Mode after flashing.

### 5.5 Device UX

Windows should have a board-aware device surface that shows:
- connection / update / ESP bootloader status,
- board type,
- hardware UID summary,
- claimed / cached / unclaimed state,
- offline availability messaging,
- a local "My devices" view from cache/backend,
- board-aware primary actions:
  - STM32: `Claim device` or `Update firmware`
  - ESP32-S3: `Claim and flash` or `Flash firmware`

### 5.6 Verification / diagnostics

Windows should expose:
- run-mode authenticity verification,
- update-mode authenticity verification where applicable,
- flashing / provisioning activity logs,
- clear operator-readable error messages for serial-port selection, bootloader entry, and backend provisioning failures.

---

## 6) Remaining verification work

The main remaining work after the parity code changes is validation on a real Windows workstation:

1. Build validation
- confirm the WinUI project builds cleanly on Windows 11 with the expected SDK/toolchain.

2. STM32 hardware validation
- verify claim + DFU provision path on an unclaimed STM32 board,
- verify secure update path on an already claimed STM32 board,
- verify Run Mode / Update Mode authenticity checks.

3. ESP32-S3 hardware validation
- build the Windows `emwaver-esp-helper.exe`,
- confirm the helper is copied into app output,
- confirm serial-port detection, bootloader detection, claim-and-flash, and reconnect-to-Run-Mode behavior on actual ESP32-S3 boards.

4. UX cleanup after workstation testing
- tighten copy, progress wording, and any Windows-specific driver or COM-port edge cases found during manual tests.

---

## 7) Interop note

`Interop/NativeBufferRust.cs` exists, but AGENTS guidance marks legacy Rust buffer-core dependency as removed from product-critical path.

Treat any Rust interop usage here as transitional/legacy unless explicitly re-validated.

---

## 8) Build environment (Windows dev machine)

Required:
- Windows 11
- Visual Studio 2022
  - .NET desktop workload
  - Windows App SDK / WinUI 3 tooling
- .NET SDK 8.x

Open `EMWaver.sln` in Visual Studio for build/run/debug.

---

## 9) Repository guardrail for this folder

Per repo guidance: in this agent environment, avoid running full Windows builds automatically due to file-lock/permission instability.

Expected workflow:
- edit code/docs,
- commit/push,
- validate build/run on a Windows workstation.

---

## 10) Documentation maintenance rule

When changing page structure or service responsibilities in Windows app:
- update this README in the same PR,
- include any protocol-impact changes also in backend/daemon/frontend docs where relevant.
