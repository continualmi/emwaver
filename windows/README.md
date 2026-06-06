# EMWaver Windows App (`/windows`)

Native Windows desktop app (WPF) for EMWaver.

Target: Windows 11 only.

---

## 1) Scope

This folder contains the full Windows client:
- USB/BLE transport integration,
- script runtime UI and tooling pages,
- native local script/runtime views,
- firmware update flow integration,
- desktop MCP bridge migration.

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

WPF views:
- `Views/ScriptsView*`
- `Views/DeviceConnectionWindow*`
- `Views/SettingsWindow*`
- `Views/FirmwareUpdateWindow*`

Core service layer:
- `Services/UsbMidiSysex.cs` (shared SysEx/superframe transport codec)
- `Services/WindowsDeviceManager.cs` (device lifecycle)
- `Services/ScriptRepository.cs` (script storage)
- `Services/FirmwareUpdateManager.cs` + `Services/Dfu.cs` (firmware/update)
- `Services/AppSettings.cs` / `Services/AppServices.cs`
- `Services/AppUpdateService.cs` (desktop app update manifest, download, installer launch)

Scripting/runtime:
- `Scripting/ScriptEngine.cs`
- `Scripting/ScriptModel.cs`
- `Scripting/PlotBufferStore.cs`
- `Scripting/SimulatorCommandBridge.cs`

Auxiliary:
- `Converters/*`
- `Models/*`
- `ViewModels/*`

---

## 3) Runtime capabilities

## 3.1 Device connection and transport

Windows app communicates with EMWaver hardware over USB MIDI and ESP32 BLE, and hosts device operations from the desktop runtime.

Transport logic lives under `Services/UsbMidiSysex.cs` and related device manager services. USB MIDI remains preferred when a wired device is available. When no wired MIDI port is found and auto-connect is enabled, Windows scans for the EMWaver BLE service and connects to ESP32 boards automatically. BLE carries the same SysEx/superframe envelope as USB MIDI so command opcodes and script behavior remain shared across transports. Classic ESP32 boards do not expose the USB MIDI runtime; on Windows they connect through BLE or a provisioned Wi-Fi endpoint after flashing the ESP32 target firmware. The Windows BLE writer mirrors the Apple clients by preferring GATT write-without-response when available, with chunked fallback for adapters that reject a full 48-byte SysEx write. The connection window intentionally avoids periodic ESP serial bootloader probes because opening the COM port can reset classic ESP32 boards and disrupt BLE; serial probing is limited to the firmware update flow.

Windows also supports a manual ESP32 Wi-Fi runtime connection through the firmware WebSocket endpoint at `ws://<host>:3922/v1/ws`. The device menu and Device page expose `Connect Wi-Fi` for trusted LAN/VPN endpoints, and the Device page exposes Wi-Fi setup actions for sending, clearing, and checking ESP32 SSID/password provisioning over the active local transport. Wi-Fi uses the same 36-byte superframe payload path as USB MIDI and BLE; mDNS discovery remains planned separately.

### 3.1.1 Transport session heartbeat (connection liveness)

All EMWaver transports must use a **transport session heartbeat** to detect disconnections reliably. Platform-level transport status signals (BLE GATT disconnection callbacks, USB device removal events, Wi-Fi socket closures) are unreliable across OS versions and board states — a BLE peripheral can stop responding without the OS ever firing `Disconnected`; a USB MIDI device can silently vanish without a removal event. The only way to confirm the device is actually still there is to ask it: send a known opcode and verify the echo comes back.

The EMWaver protocol is a **single serial bus** — one stream of commands, responses, and streaming data multiplexed over a shared 36-byte superframe lane. The heartbeat is just another command queued on that bus alongside script opcodes and future MCP tool calls. There is no contention or separate channel; the heartbeat naturally interleaves without disrupting other traffic. The firmware echoes it immediately, and the round-trip time confirms liveness without adding protocol complexity.

**Protocol:** The app sends opcode `0x0B` (TransportSession) with sub-opcode `0x03` (Heartbeat) every 2 seconds over the active transport (USB MIDI, BLE, or Wi-Fi). The firmware echoes the heartbeat back on the same transport. If the host does not receive the echo within a window of two heartbeat intervals, the connection is marked as lost, and `ConnectedPort` / `IsConnected` is cleared.

**macOS:** Implemented in `MacUSBManager` (`transportSessionHeartbeatIntervalSeconds = 2.0`, `connectionPollIntervalSeconds = 5.0`). The heartbeat timer is created when a transport session is claimed and cancelled on disconnect.

**Windows:** ✅ Implemented in `WindowsDeviceManager` (`_transportHeartbeatTimer`, 2000 ms interval). Windows now matches macOS by deferring ESP32 transport-session claims until the first script/provisioning operation instead of claiming during BLE/Wi-Fi connection setup. The heartbeat starts after that claim, checks the response byte, and disconnects after 2 consecutive misses. A 5-second connection poll timer (`_connectionPollTimer`) reconciles USB MIDI port presence and BLE device state. Started via `BeginConnectionMonitoring()` from `MainWindow` constructor.

## 3.2 Scripting UX

Scripts UI and runtime behavior are centered in `ScriptsPage` and `Scripting/*` modules, including plot/state helpers and script document handling.

`Scripting/SimulatorCommandBridge.cs` is the Windows test adapter for the shared `simulator/fixtures/*.json` contract. It can be passed to `ScriptEngine.Setup` as the `sendPacket` delegate so hardware-touching `.js` scripts can run in tests without a physical board.

`EMWaver.Tests` contains the hosted-CI simulator smoke for Windows. It runs a hardware-touching `.js`/JSX script through the real Windows `ScriptEngine` and `SimulatorCommandBridge`, then asserts the rendered UI includes values from `simulator/fixtures/basic-board.json`.

## 3.3 Architecture boundary

The Windows app is self-contained. Windows keeps its own native script UI, local transport managers, desktop MCP bridge surface, and firmware/update flows. The desktop MCP server should live in the running app and route into the same runtime as the human UI.

## 3.4 Firmware update path

Firmware update windows/managers are present:
- `Views/FirmwareUpdateWindow*`
- `Services/FirmwareUpdateManager.cs`
- `Services/Dfu.cs`

The current packaged Windows firmware payload is copied from the repo root firmware bundle at build time:
- `../../firmware/emwaver.bin` -> app output `emwaver.bin`

Windows now follows the same board-class split as macOS:
- STM32 boards use the managed DFU setup/update flow.
- ESP32, ESP32-S2, and ESP32-S3 boards use the bundled serial flashing helper plus bundled target-specific ESP images.
- Windows setup/update UI is board-aware. It should not require device registration before flashing.

## 3.5 App settings and appearance

Settings surface includes app-level preferences such as:
- script diagnostics visibility,
- future local MCP enablement/status.
- desktop app update checks.

Desktop app updates are local-first and account-free. Windows checks the EMWaver-owned manifest at `https://emwaver.ai/updates/windows/latest.json`, with a GitHub Release metadata fallback, then downloads the version-pinned installer URL declared by that manifest. The installer is verified with the manifest SHA-256 when present and launched with Inno Setup silent/restart-safe arguments.

The Windows app intentionally ships a single stable light UI theme; the former dark theme option is disabled.

The WPF Agent drawer, Agent API key storage, SQLite chat storage, and MGPT
client path have been removed. Their hardware primitive model is now
repackaged as the desktop MCP surface: external agents should use MCP
tools such as `list_scripts`, `read_script`, `run_script`, `write_script`,
`device_state`, `spi_transfer`, `gpio_write`, `gpio_read`, and `analog_read`.
The WPF script editor uses AvalonEdit syntax highlighting plus visible Find and
Go to Line controls.

## 3.6 Current parity status vs macOS

Windows is intended to track the current macOS app in the firmware setup/update, local runtime, and desktop MCP layers.

Current MCP implementation:

- Settings exposes a `Desktop MCP` section with an enable switch, loopback endpoint, and generated bearer token.
- When enabled, the running app serves Streamable-HTTP-style JSON-RPC at `http://127.0.0.1:3923/mcp`.
- The tool slice supports script list/read/write/run/stop, device status, and direct hardware primitives: `list_scripts`, `read_script`, `write_script`, `run_script`, `stop_script`, `device_state`, `spi_transfer`, `gpio_read`, `gpio_write`, and `analog_read`.
- The server is intentionally in-process; do not add a sidecar, daemon, or CLI control plane for this path.

What Windows already has:
- USB run-mode transport,
- ESP32 BLE run-mode transport,
- STM32 DFU firmware flashing,
- the legacy Agent API-key auth path removed.

Windows now includes:
- board-aware device state (`board_type`, last detected board info),
- board-specific update UX split between STM32 DFU and ESP serial flashing,
- bundled ESP flashing helper + bundled ESP32 / ESP32-S2 / ESP32-S3 images when present in the workspace/build output,
- ESP bootloader detection and BOOT / RESET guidance,
- activity-log surfaces around setup and update.

---

## 4) Historical Windows gaps now addressed

The parity work in this folder specifically addressed the older Windows gaps relative to macOS:

1. Device model
- `Services/WindowsDeviceManager.cs` should track connected board type and last-detected board info without requiring hardware UID identity for local use.

2. Update architecture
- `Services/FirmwareUpdateManager.cs` now splits STM32 managed DFU from ESP serial flashing.
- STM32 setup/update does not depend on account registration, `board_type + hardware_uid` minting, or ownership state.
- ESP32, ESP32-S2, and ESP32-S3 setup/update use the bundled helper + target-specific image set when present.

3. Device UI / wording
- `Views/DeviceConnectionWindow*` and `Views/FirmwareUpdateWindow*` are board-aware and local-first.

4. ESP32 support
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

### 5.4 ESP update flow

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
  - ESP32 / ESP32-S2 / ESP32-S3: `Flash firmware`

### 5.6 Diagnostics

Windows should expose:
- flashing activity logs,
- clear operator-readable error messages for serial-port selection and bootloader entry.

---

## 6) Remaining verification work

The main remaining work after the parity code changes is validation on a real Windows workstation:

1. Build validation
- confirm the WPF project builds cleanly on Windows 11 with the expected SDK/toolchain.
- confirm `scripts/rebirth-windows-validation.ps1 -Ci` passes on hosted Windows CI, including the simulator-backed script-engine test.
- confirm ESP32 BLE scan/connect and notification delivery on a Bluetooth-capable Windows 11 machine.

2. STM32 hardware validation
- verify DFU setup path on a fresh STM32 board,
- verify update path on an already account-cached STM32 board.

3. ESP hardware validation
- build the Windows `emwaver-esp-helper.exe`,
- confirm the helper is copied into app output,
- confirm serial-port detection, bootloader detection, local flash, and reconnect-to-Run-Mode behavior on actual ESP32, ESP32-S2, and ESP32-S3 boards.

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
  - .NET WPF tooling
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
- include any protocol-impact changes also in the relevant firmware and transport docs.
