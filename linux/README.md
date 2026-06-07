# Linux App (`/linux`)

Native Linux EMWaver application workspace.

This is the Rust + GTK4/libadwaita native app workspace. Linux follows the same local app + script runtime + Desktop MCP direction as macOS and Windows.

Local-first rules:
- local scripts, device discovery, and firmware setup must not require an EMWaver account, cloud activation, hosted relay, subscription check, device registration, or hardware ownership gate;
- MCP-client access belongs to the local desktop MCP bridge;
- scripts and app state stay on the user's Linux machine by default.

## Script UI runtime architecture goal

The Linux app must match the working native architecture used by the rest of the platform, especially macOS: script UI is not a fake preview. A rendered script UI is backed by a live script session that can invoke JavaScript actions and send real packets through the selected local device transport.

Target shape:

```text
GTK main thread
  - owns GTK widgets only
  - sends script UI actions to a session worker
  - receives render trees/status/logs and updates widgets

Script UI session worker
  - owns the Boa JavaScript context
  - owns captured script UI action tokens
  - owns the script/device packet bridge
  - receives every script `render()` call through the Rust host render callback
  - receives script `console.log`/`warn`/`error` calls through the Rust host console callback
  - invokes actions and performs device I/O away from the GTK loop

Selected transport
  - USB MIDI, BLE, or Wi-Fi
  - receives packets from the script bridge and returns actual board responses
```

Important constraints:
- GTK widgets must stay on the GTK main thread.
- Boa `Context`/`ScriptUiRuntime` is not `Send`; create and keep it inside the session worker instead of moving it between threads.
- Script UI action buttons must call the live packet bridge (`__emwSendPacket` -> Rust -> selected transport), never synthetic success responses.
- Script `render()` must be a host callback like macOS `_scriptRender`, not a final-tree poll after an action completes. Intermediate renders from scripts such as `cc1101.emw` must stream to GTK so script-owned UI nodes like `Progress({ value })` update live.
- Script `console.log`/`warn`/`error` must be a host callback like macOS `_consolePrint` and feed the app log/status surface.
- The rendered script UI must remain visible while an action runs. Do not clear the script UI and replace it with a generic "running" placeholder; show busy/status/log feedback around the live view and update the tree when the session emits a new render.
- Do not build Linux-only preview shims. If behavior is meant to match macOS, implement the same session/device-bridge concept rather than patching the GTK widget layer.
- User-facing UI should say "script action" or describe the action itself; internal terms like "handler" should not leak into normal UI.
- The end state is parity with macOS `_scriptSendPacket`/`ScriptDeviceWrapper.sendCommand(...)`: local, account-free, real device I/O, with the UI remaining responsive.

## Native transport contract

Linux transport/runtime work must start from the native app contract, not from isolated packet symptoms. The script device path is a lifecycle:

```text
connect selected local transport
  -> claim transport session when required
  -> send command-lane packets / receive response lanes
  -> keep the session alive
  -> release the transport session
  -> close transport
```

This is required for BLE and Wi-Fi script hardware access and for ESP32-class transports that arbitrate command ownership. Matching SysEx bytes alone is not enough: firmware may ignore, reject, or return unusable data if the host has not claimed the transport session first.

Session opcodes are part of the internal transport contract:

```text
0x0B 0x01 <source>   transport-session connect
0x0B 0x02 <source>   transport-session disconnect
0x0B 0x03 <source>   transport-session heartbeat

source 0x01          USB
source 0x02          BLE
source 0x03          Wi-Fi
```

Native references:
- macOS: `MacUSBManager.beginScriptTransportSession(...)`, `sendTransportSessionCommandInternal(...)`, `startTransportSessionHeartbeatInternal(...)`.
- Android: `USBService.beginTransportSession(...)`, `startHeartbeat(...)`, `endTransportSession(...)`.
- Windows: `WindowsDeviceManager` transport-session lifecycle.

Linux requirements:
- BLE and Wi-Fi script packet sessions must send CONNECT before normal hardware packets.
- Long-lived BLE/Wi-Fi sessions must send HEARTBEAT while claimed.
- Sessions must send DISCONNECT during teardown when practical.
- Packet bridge fixes must compare against the full native lifecycle before changing framing/codec code.
- Do not add Linux-only fake responses or widget shims to mask missing session ownership.

See also `TRANSPORT_PARITY_AUDIT.md` for active differences and follow-up items.

## Workspace layout

- `crates/emwaver-linux-app` - GTK4/libadwaita app shell.
- `crates/emwaver-linux-core` - app model, local device registry, script-session lifecycle.
- `crates/emwaver-linux-runtime` - JavaScript-facing runtime compiler and command-step generation.
- `crates/emwaver-linux-transport` - common transport traits plus USB/BLE/Wi-Fi adapters; simulator support is internal test infrastructure, not a user-facing device choice.
- `crates/emwaver-linux-firmware` - STM32 DFU and ESP32 serial flashing orchestration.
- `resources/udev/99-emwaver.rules` - Linux device access rules for supported run/update modes.

## Current implementation status

The first native slice is M0/M1:
- core registry deduplicates records by local hardware UID when present;
- script sessions enforce selected-device claims and busy-device rejection;
- USB discovery classifies STM32 run-mode USB MIDI, STM32 DFU, and common ESP32 serial adapters with permission diagnostics;
- Rust USB MIDI SysEx/superframe codec matches the STM32 fixed 36-byte superframe, 48-byte SysEx, and 64-byte USB-MIDI transaction contract;
- STM32 run-mode USB MIDI transport can open the discovered device, claim the MIDI interface, send encoded superframes, and read decoded response superframes;
- shared command probes read firmware version, board type, and local hardware UID over any transport implementation;
- transport-backed command script execution can run command-lane steps over any transport, stop on busy/error responses, and produce a local execution report;
- JavaScript runtime compiler supports early `emw.command`, `device.*`, and `gpio.*` APIs and emits transport command steps for the runner;
- the runtime crate exports both JavaScript compilation and execution entry points for the GTK app, including the first macOS-aligned local module loader/import transform for bundled script libraries plus uppercase JSX transform, script UI tree capture, and a live script UI runtime that can invoke captured script actions;
- the GTK Run button routes selected local devices through the JavaScript runtime and transport runner;
- the GTK shell seeds discovered USB candidates into the local device list and probes accessible STM32 run-mode boards for local metadata;
- the GTK shell is now script-workspace first, loads the shared `assets/default-scripts` bundle, groups scripts as Examples/Libraries/Kernel/Custom Scripts, keeps bundled scripts read-only, defaults the main content to runtime preview, supports local New/Save/Make Copy behavior, and exposes row-level Run/Edit/Stop controls with inline running state aligned with the macOS script workspace direction;
- the GTK script workspace uses GtkSourceView for JavaScript editing with line numbers, syntax highlighting, find, go-to-line, line wrap, script search, and a runtime output switch that renders captured script UI trees with native GTK widgets for common layout/control nodes;
- script UI rendering now uses a macOS-style live session boundary: GTK keeps widgets on the main thread, a worker owns the Boa runtime and script action invocation, and the packet bridge keeps the selected local transport connected for action-driven device I/O;
- the GTK shell owns the local desktop MCP tool surface;
- the GTK header exposes a Desktop MCP button that opens the local endpoint/token controls and documentation links;
- the GTK device sheet now follows the macOS device workflow more closely with selected-device status, grouped local transports, transport badges, board/firmware/UID metadata, manual Wi-Fi target validation, firmware action context, and udev permission guidance;
- the GTK firmware sheet is board-aware, validates bundled STM32 and ESP32-S3 firmware image plans, probes STM32 DFU presence, shows image offsets/paths, routes STM32 flashing through the local Rust DFU backend, and routes ESP32-S3 serial flashing through the bundled esptool-compatible helper with BOOT/RESET guidance and progress logs;
- the firmware crate can plan bundled STM32 and ESP32-S3 images, validate required bundled assets, flash STM32 DFU through the existing Rust DFU backend, and orchestrate ESP32-S3 serial flashing with fixed offsets through the local helper;
- the Wi-Fi transport crate can build manual LAN/VPN targets, expose them as selectable devices via `EMWAVER_WIFI_HOST`/`EMWAVER_WIFI_PORT`, discover `_emwaver._tcp.local.` records over mDNS, filter TXT metadata for protocol `1` plus `wifi` capability, validate discovered records with a hardware UID WebSocket probe before showing them live, and send/receive EMWaver SysEx superframes over WebSocket binary messages;
- the BLE transport crate now carries the same EMWaver service/command/notify UUID contract as macOS, validates BlueZ adapter/address targets, scans BlueZ adapters through `btleplug`, connects matching peripherals, writes command frames to the command characteristic, and reads notification frames from the notify characteristic;
- firmware crates expose local-first orchestration boundaries without gating local hardware access;
- the app crate contains a GTK4/libadwaita shell that shows script editor controls, log output, local device metadata, firmware, and settings.

Full JavaScript runtime parity beyond the initial command/gpio/device API, local module loading, JSX/script-tree capture, initial GTK script-tree rendering, and first script UI action invocation path, Linux hardware validation for BLE GATT I/O and ESP32 serial flashing, Wi-Fi provisioning UI/status, and packaged installers are staged behind the crate boundaries and are not complete yet.

## Packaging

Linux preview packaging is owned by `.github/workflows/linux-deb-release.yml` (`Linux DEB Release`) and `linux/scripts/package-linux.sh`.

The packaging path currently produces:

- `EMWaver-linux-amd64.deb` for Debian/Ubuntu-style systems;
- `EMWaver-linux-x64.tar.gz` as a generic staged `/usr` tree.

Packages install the GTK app binary, desktop entry, AppStream metadata, hicolor icon, default scripts, STM32 firmware payload, optional ESP helper source, and udev rules. The launcher sets `EMWAVER_DEFAULT_SCRIPTS_DIR`, `EMWAVER_FIRMWARE_DIR`, and `EMWAVER_ESP_HELPER_SOURCE` so packaged builds do not depend on a source checkout.

Linux remains a preview channel until hardware validation and installer UX are complete.

## Build and validation

Core crates can be validated on any Rust host:

```sh
cargo test --manifest-path linux/Cargo.toml --workspace --exclude emwaver-linux-app
```

The GTK app requires Linux development packages for GTK4, libadwaita, and GtkSourceView 5. On Ubuntu/Debian:

```sh
sudo apt install libgtk-4-dev libadwaita-1-dev libgtksourceview-5-dev libgraphene-1.0-dev pkg-config
cargo run --manifest-path linux/Cargo.toml -p emwaver-linux-app
```

Build release packages locally on Linux after building the app:

```sh
cargo build --manifest-path linux/Cargo.toml --release -p emwaver-linux-app
EMWAVER_LINUX_VERSION=$(cat ../VERSION) linux/scripts/package-linux.sh
```

Do not add a separate daemon or browser relay to make the app run. Hardware transports belong in-process behind `emwaver-linux-transport`, and the MCP server is part of the running native app.

Current MCP implementation:

- Settings exposes a `Desktop MCP` section with an enable switch, loopback endpoint, and generated bearer token.
- When enabled, the running app serves Streamable-HTTP-style JSON-RPC at `http://127.0.0.1:3923/mcp`.
- The tool slice supports script list/read/write, synchronous selected-device run, no-op stop status, device status, and direct hardware primitives: `list_scripts`, `read_script`, `write_script`, `run_script`, `stop_script`, `device_state`, `spi_transfer`, `gpio_read`, `gpio_write`, and `analog_read`.
- The server uses the same `ScriptRepository` roots as the GTK script list and a refreshed app-model device snapshot.
- `run_script` executes through the existing Linux JavaScript runtime and selected USB/BLE/Wi-Fi transport; persistent MCP-started GTK session ownership is still pending.
- Hardware primitive tools execute through the selected USB/BLE/Wi-Fi transport. BLE and Wi-Fi primitive calls claim the firmware transport session before normal command packets and release it afterward when practical.
- Linux SPI primitive transfers currently support up to 14 TX bytes per call because the active Linux command lane is 18 bytes.
- Local validation on macOS is blocked by missing GTK4/libadwaita system packages; run app-level checks on a Linux host with `gtk4`, `libadwaita`, `gdk-pixbuf-2.0`, and `graphene-gobject-1.0` development packages installed.
