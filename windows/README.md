# EMWaver Windows App (`/windows`)

Native Windows desktop app (WinUI 3 / Windows App SDK) for EMWaver.

Target: Windows 11 only.

---

## 1) Scope

This folder contains the full Windows client:
- USB transport integration,
- script runtime UI and tooling pages,
- remote host/session control views,
- firmware update flow integration,
- optional cloud/auth/account surfaces.

The local-first rule is that connected supported boards can run local `.emw` scripts without account sign-in, backend activation, subscription checks, or claimed-device cache membership. Account/device registration remains optional hosted-service state, not a local runtime gate.

Project files:
- solution: `windows/EMWaver.sln`
- app project: `windows/EMWaver/EMWaver.csproj`
- test project: `windows/EMWaver.Tests/EMWaver.Tests.csproj`

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
- `Scripting/SimulatorCommandBridge.cs`

Auxiliary:
- `Dialogs/*`
- `Converters/*`
- `Models/*`

---

## 3) Runtime capabilities

## 3.1 Device connection and transport

Windows app communicates with EMWaver hardware over USB and hosts device operations from the desktop runtime.

Transport logic lives under `Services/UsbMidiSysex.cs` and related device manager services.

## 3.2 Scripting UX

Scripts UI and runtime behavior are centered in `ScriptsPage` and `Scripting/*` modules, including plot/state helpers and script document handling.

`Scripting/SimulatorCommandBridge.cs` is the Windows test adapter for the shared `simulator/fixtures/*.json` contract. It can be passed to `ScriptEngine.Setup` as the `sendPacket` delegate so hardware-touching `.emw` scripts can run in tests without a physical board.

`EMWaver.Tests` contains the hosted-CI simulator smoke for Windows. It runs a hardware-touching `.emw` script through the real Windows `ScriptEngine` and `SimulatorCommandBridge`, then asserts the rendered UI includes values from `simulator/fixtures/basic-board.json`.

## 3.3 Remote host control

Remote control pages/services provide host listing and attach/control behavior for cloud-connected hosts:
- `Pages/HostsPage*`
- `Pages/RemoteHostControlPage*`

Local-first gateway behavior:
- `Services/Cloud/RemoteControlHostService.cs` can connect directly to the localhost gateway as `role=app`.
- Default local gateway URL is `ws://127.0.0.1:3921/v1/ws`.
- Override with `EMWAVER_LOCAL_GATEWAY_URL`.
- Disable local gateway connection with `EMWAVER_LOCAL_GATEWAY_DISABLED=1`.
- Hosted remote-control fallback is outside the core local-first path and only activates when `EMWAVER_HOSTED_REMOTE_CONTROL_ENABLED=1`.
- Hosted host-session directory UI and heartbeat are hidden from the local-first core by default and only activate when `EMWAVER_HOSTED_SERVICES_UI_ENABLED=1`.
- In local gateway mode, the Windows app owns `.emw` execution and USB/device transport; the gateway only forwards browser/CLI control messages.

## 3.4 Firmware update path

Firmware update dialogs/managers are present:
- `Dialogs/FirmwareUpdateDialog*`
- `Services/FirmwareUpdateManager.cs`
- `Services/Dfu.cs`

The current packaged Windows firmware payload is copied from the repo root firmware bundle at build time:
- `../../firmware/emwaver.bin` -> app output `emwaver.bin`

Windows now follows the same board-class split as macOS:
- STM32 boards use the managed DFU setup/update flow.
- ESP32-S3 boards use the bundled serial flashing helper plus bundled ESP images.
- Windows setup/update UI is board-aware and can optionally register devices before flashing when hosted services need that state.

## 3.5 App settings and appearance

Settings surface includes app-level preferences such as:
- appearance mode (`System`, `Light`, `Dark`),
- staff-only backend/frontend environment switching.

## 3.6 Current parity status vs macOS

Windows is intended to track the current macOS app in the firmware setup/update and optional account registration layer.

What Windows already has:
- USB run-mode transport,
- STM32 DFU firmware flashing,
- web-managed API-key auth, host session, remote control, and Pro entitlement plumbing.

Windows now includes:
- board-aware device state (`board_type`, hardware UID, last detected board info),
- backend-tethered optional account registration / restore flow using `/provisioning/mint`,
- cached account-device list with offline-mode fallback for hosted-service visibility,
- board-specific update UX split between STM32 DFU and ESP32-S3 serial flashing,
- bundled ESP32-S3 flashing helper + bundled ESP images when present in the workspace/build output,
- ESP bootloader detection and BOOT / RESET guidance,
- activity-log surfaces around setup and update.
- web-managed API-key auth for cloud/account features, with the account dialog validating keys against `/v1/auth/key` and opening the EMWaver web account page for management.

---

## 4) Historical Windows gaps now addressed

The parity work in this folder specifically addressed the older Windows gaps relative to macOS:

1. Device model
- `Services/WindowsDeviceManager.cs` now tracks hardware UID, connected board type, and last-detected board info in addition to version/runtime state.

2. Update architecture
- `Services/FirmwareUpdateManager.cs` now splits STM32 managed DFU from ESP32-S3 serial flashing.
- STM32 optional account registration/update is keyed by `board_type + hardware_uid` and then flashes managed firmware.
- ESP32-S3 setup/update uses the bundled helper + bundled image set when present.

3. Device UI / wording
- `Pages/DevicePage*` and `Dialogs/FirmwareUpdateDialog*` are now board-aware and expose optional account-cache state, offline messaging, verification, and activity logs.

4. Optional account / device-cache integration
- Windows now has a local account-device cache equivalent to macOS `AccountDevicesService`; local script execution does not depend on that cache.
- Account-cached devices are keyed by `board_type + hardware_uid` for offline-aware hosted-service behavior.

5. ESP32-S3 support
- Windows now detects ESP bootloader availability, resolves flash-capable serial ports, and guides the user toward the serial flashing path instead of forcing STM32 DFU semantics onto ESP boards.

6. Operator diagnostics
- Windows now exposes flashing and provisioning activity logs.

---

## 5) Full parity target

To bring Windows to feature parity with the current macOS implementation, Windows should reach the following behavior:

### 5.1 Device state and transport

Windows should:
- read hardware UID in Run Mode using the shared device opcode,
- infer / store current board type and last detected board type,
- preserve last detected hardware UID for ESP and reconnect scenarios,
- rely on `board_type + hardware_uid` only.

### 5.2 Optional account registration / restore / attach

Windows should:
- call `/provisioning/mint` with `board_type + hardware_uid` only for optional hosted-service setup,
- maintain a local account-device cache keyed by `board_type + hardware_uid`,
- support offline account-cache visibility from the cached device list.

Windows should treat hosted registration as account-plan enforcement only for hosted services:
- backend entitlements determine whether another device can be registered on the account for hosted features,
- no account, activation, or per-device purchase flow should be required to use an additional board locally.

### 5.3 STM32 update flow

Windows STM32 flow should match the current managed model:
- STM32 boards can be locally provisioned/updated from the app,
- account-cached STM32 boards update through the same DFU path,
- update UI clearly distinguishes local setup/update vs optional account-cache behavior.

### 5.4 ESP32-S3 update flow

Windows ESP flow should match the macOS board-class split:
- Run Mode remains USB,
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
- optional account-cache state,
- offline availability messaging,
- a local "My devices" view from cache/backend,
- board-aware primary actions:
  - STM32: `Claim device` or `Update firmware`
  - ESP32-S3: `Claim and flash` or `Flash firmware`

### 5.6 Diagnostics

Windows should expose:
- flashing / provisioning activity logs,
- clear operator-readable error messages for serial-port selection, bootloader entry, and backend provisioning failures.

---

## 6) Remaining verification work

The main remaining work after the parity code changes is validation on a real Windows workstation:

1. Build validation
- confirm the WinUI project builds cleanly on Windows 11 with the expected SDK/toolchain.
- confirm `scripts/rebirth-windows-validation.ps1 -Ci` passes on hosted Windows CI, including the simulator-backed script-engine test.

2. STM32 hardware validation
- verify DFU setup path on a fresh STM32 board,
- verify update path on an already account-cached STM32 board.

3. ESP32-S3 hardware validation
- build the Windows `emwaver-esp-helper.exe`,
- confirm the helper is copied into app output,
- confirm serial-port detection, bootloader detection, optional account registration/flash, and reconnect-to-Run-Mode behavior on actual ESP32-S3 boards.

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
- .NET SDK 10.x

Open `EMWaver.sln` in Visual Studio for build/run/debug.

Hosted CI uses:

```powershell
scripts/rebirth-windows-validation.ps1 -Ci
```

That command restores/builds the Windows solution and runs `EMWaver.Tests`. It does not validate attached USB/MIDI hardware or interactive local gateway control.

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
