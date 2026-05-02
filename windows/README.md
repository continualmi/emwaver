# EMWaver Windows App (`/windows`)

Native Windows desktop app (WinUI 3 / Windows App SDK) for EMWaver.

Target: Windows 11 only.

---

## 1) Scope

This folder contains the full Windows client:
- USB transport integration,
- script runtime UI and tooling pages,
- local gateway/app-host control views,
- firmware update flow integration,
- Agent client surfaces.

The local-first rule is that connected supported boards can run local `.emw` scripts immediately without account sign-in, backend activation, subscription checks, claimed-device cache membership, hardware-UID registration, device minting, or device limits.

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
- Windows setup/update UI is board-aware. It should not require device registration before flashing.

## 3.5 App settings and appearance

Settings surface includes app-level preferences such as:
- appearance mode (`System`, `Light`, `Dark`),
- staff-only backend/frontend environment switching.

## 3.6 Current parity status vs macOS

Windows is intended to track the current macOS app in the firmware setup/update and local gateway layers.

What Windows already has:
- USB run-mode transport,
- STM32 DFU firmware flashing,
- legacy web-managed API-key auth, host session, remote control, and Pro entitlement plumbing that should be migrated away from local hardware paths.

Windows now includes:
- board-aware device state (`board_type`, last detected board info),
- legacy backend-tethered account registration / restore flow using `/provisioning/mint` that is migration debt,
- legacy cached account-device list for hosted-service visibility,
- board-specific update UX split between STM32 DFU and ESP32-S3 serial flashing,
- bundled ESP32-S3 flashing helper + bundled ESP images when present in the workspace/build output,
- ESP bootloader detection and BOOT / RESET guidance,
- activity-log surfaces around setup and update.
- legacy web-managed API-key auth for cloud/account features, with the account dialog validating keys against `/v1/auth/key` and opening the EMWaver web account page for management. The target Agent model is a user-provided MGPT Agent API key, not an EMWaver account key.

---

## 4) Historical Windows gaps now addressed

The parity work in this folder specifically addressed the older Windows gaps relative to macOS:

1. Device model
- `Services/WindowsDeviceManager.cs` should track connected board type and last-detected board info without requiring hardware UID identity for local use.

2. Update architecture
- `Services/FirmwareUpdateManager.cs` now splits STM32 managed DFU from ESP32-S3 serial flashing.
- STM32 setup/update should not depend on account registration, `board_type + hardware_uid` minting, or hosted ownership state.
- ESP32-S3 setup/update uses the bundled helper + bundled image set when present.

3. Device UI / wording
- `Pages/DevicePage*` and `Dialogs/FirmwareUpdateDialog*` are board-aware; optional account-cache state is legacy migration debt.

4. Optional account / device-cache integration
- Windows still has legacy local account-device cache code; local script execution must not depend on that cache and the cache should be removed from the core path.
- Account-cached devices keyed by `board_type + hardware_uid` are legacy closed-source-platform behavior and should not be extended.

5. ESP32-S3 support
- Windows now detects ESP bootloader availability, resolves flash-capable serial ports, and guides the user toward the serial flashing path instead of forcing STM32 DFU semantics onto ESP boards.

6. Operator diagnostics
- Windows now exposes flashing activity logs; provisioning/minting logs are legacy migration debt.

---

## 5) Full parity target

To bring Windows to feature parity with the current macOS implementation, Windows should reach the following behavior:

### 5.1 Device state and transport

Windows should:
- avoid requiring hardware UID reads in Run Mode before local use,
- infer / store current board type and last detected board type,
- preserve last detected board metadata for ESP and reconnect scenarios without using immutable UID as a gate,
- avoid `board_type + hardware_uid` as a required identity model.

### 5.2 Optional account registration / restore / attach

Windows should:
- remove `/provisioning/mint` and `board_type + hardware_uid` assumptions from the core setup path,
- remove local account-device cache behavior from local hardware control,
- remove offline account-cache visibility from the core local device UX.

No account, activation, minting, hardware-UID registration, device limit, or per-device purchase flow should be required to use an additional board locally.

### 5.3 STM32 update flow

Windows STM32 flow should match the current managed model:
- STM32 boards can be locally provisioned/updated from the app,
- account-cached STM32 boards update through the same DFU path,
- update UI removes optional account-cache behavior from the core local setup/update flow.

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
- board/runtime summary,
- offline availability messaging,
- a local "My devices" view from cache/backend,
- board-aware primary actions:
  - STM32: `Claim device` or `Update firmware`
  - ESP32-S3: `Claim and flash` or `Flash firmware`

### 5.6 Diagnostics

Windows should expose:
- flashing activity logs,
- clear operator-readable error messages for serial-port selection and bootloader entry.

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
- confirm serial-port detection, bootloader detection, local flash, and reconnect-to-Run-Mode behavior on actual ESP32-S3 boards.

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
