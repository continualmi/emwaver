# EMWaver Windows App (`/windows`)

Native Windows desktop app (WinUI 3 / Windows App SDK) for EMWaver.

Target: Windows 11 only.

---

## 1) Scope

This folder contains the full Windows client:
- USB/BLE transport integration,
- script runtime UI and tooling pages,
- native local script/runtime views,
- firmware update flow integration,
- Agent client surfaces.

The local-first rule is that connected supported boards can run local `.js` scripts immediately without account sign-in, backend activation, subscription checks, claimed-device cache membership, hardware-UID registration, device minting, or device limits.

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

Core service layer:
- `Services/UsbMidiSysex.cs` (shared SysEx/superframe transport codec)
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

Windows app communicates with EMWaver hardware over USB MIDI and ESP32 BLE, and hosts device operations from the desktop runtime.

Transport logic lives under `Services/UsbMidiSysex.cs` and related device manager services. USB MIDI remains preferred when a wired device is available. When no wired MIDI port is found and auto-connect is enabled, Windows scans for the EMWaver BLE service and connects to ESP32 boards automatically. BLE carries the same SysEx/superframe envelope as USB MIDI so command opcodes and script behavior remain shared across transports.

Windows also supports a manual ESP32 Wi-Fi runtime connection through the firmware WebSocket endpoint at `ws://<host>:3922/v1/ws`. The device menu and Device page expose `Connect Wi-Fi` for trusted LAN/VPN endpoints. Wi-Fi uses the same 36-byte superframe payload path as USB MIDI and BLE; mDNS discovery and local SSID/password provisioning are still planned separately.

## 3.2 Scripting UX

Scripts UI and runtime behavior are centered in `ScriptsPage` and `Scripting/*` modules, including plot/state helpers and script document handling.

`Scripting/SimulatorCommandBridge.cs` is the Windows test adapter for the shared `simulator/fixtures/*.json` contract. It can be passed to `ScriptEngine.Setup` as the `sendPacket` delegate so hardware-touching `.js` scripts can run in tests without a physical board.

`EMWaver.Tests` contains the hosted-CI simulator smoke for Windows. It runs a hardware-touching `.js`/JSX script through the real Windows `ScriptEngine` and `SimulatorCommandBridge`, then asserts the rendered UI includes values from `simulator/fixtures/basic-board.json`.

## 3.3 Gateway boundary

The Windows app is self-contained and does not connect to the Gateway as a runtime owner. Browser and CLI control use the Rust Gateway backend; Windows keeps its own native script UI, local transport managers, and firmware/update flows.

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
- local Agent API key configuration.

The Agent pane stores local chat conversations and messages in SQLite at
`%LOCALAPPDATA%/EMWaver/agent-chat.sqlite`. The stored chats are local UI state;
Agent requests still use the user-provided API key and the configured MGPT
endpoint, and local scripts/hardware remain usable without that key.

## 3.6 Current parity status vs macOS

Windows is intended to track the current macOS app in the firmware setup/update and local gateway layers.

What Windows already has:
- USB run-mode transport,
- ESP32 BLE run-mode transport,
- STM32 DFU firmware flashing,
- local Agent API-key auth for optional Agent replies.

Windows now includes:
- board-aware device state (`board_type`, last detected board info),
- board-specific update UX split between STM32 DFU and ESP32-S3 serial flashing,
- bundled ESP32-S3 flashing helper + bundled ESP images when present in the workspace/build output,
- ESP bootloader detection and BOOT / RESET guidance,
- activity-log surfaces around setup and update.

---

## 4) Historical Windows gaps now addressed

The parity work in this folder specifically addressed the older Windows gaps relative to macOS:

1. Device model
- `Services/WindowsDeviceManager.cs` should track connected board type and last-detected board info without requiring hardware UID identity for local use.

2. Update architecture
- `Services/FirmwareUpdateManager.cs` now splits STM32 managed DFU from ESP32-S3 serial flashing.
- STM32 setup/update does not depend on account registration, `board_type + hardware_uid` minting, or ownership state.
- ESP32-S3 setup/update uses the bundled helper + bundled image set when present.

3. Device UI / wording
- `Pages/DevicePage*` and `Dialogs/FirmwareUpdateDialog*` are board-aware and local-first.

4. ESP32-S3 support
- Windows now detects ESP bootloader availability, resolves flash-capable serial ports, and guides the user toward the serial flashing path instead of forcing STM32 DFU semantics onto ESP boards.

5. Operator diagnostics
- Windows now exposes flashing activity logs.

---

## 5) Full parity target

To bring Windows to feature parity with the current macOS implementation, Windows should reach the following behavior:

### 5.1 Device state and transport

Windows should:
- avoid requiring hardware UID reads in Run Mode before local use,
- infer / store current board type and last detected board type,
- preserve last detected board metadata for ESP and reconnect scenarios without using immutable UID as a gate,
- avoid `board_type + hardware_uid` as a required identity model.

### 5.2 Local setup/update

Windows should:
- keep local setup/update independent of account sign-in,
- keep device UI based on local connection and update state,
- avoid treating immutable hardware UID values as activation or ownership identifiers.

No account, activation, minting, hardware-UID registration, device limit, or per-device purchase flow should be required to use an additional board locally.

### 5.3 STM32 update flow

Windows STM32 flow should match the current managed model:
- STM32 boards can be locally provisioned/updated from the app,
- STM32 boards update through the managed DFU path,
- update UI stays local-first.

### 5.4 ESP32-S3 update flow

Windows ESP flow should match the macOS board-class split:
- Run Mode is available over USB MIDI and BLE,
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
- board-aware primary actions:
  - STM32: `Update firmware`
  - ESP32-S3: `Flash firmware`

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
- confirm ESP32 BLE scan/connect and notification delivery on a Bluetooth-capable Windows 11 machine.

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

That command restores/builds the Windows solution and runs `EMWaver.Tests`. It does not validate attached USB/MIDI hardware.
It also does not validate attached ESP32 BLE hardware.

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
- include any protocol-impact changes also in Gateway/backend/frontend docs where relevant.
