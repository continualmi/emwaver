# EMWaver Rebirth Validation

This file tracks validation for the local-first rebirth work. It complements `TESTS.md`, which remains the manual hardware test suite.

## Gateway Consolidation

| Test | Status | Evidence |
| --- | --- | --- |
| Gateway frontend typecheck | `pass` | `cd gateway/frontend && npm run typecheck` passed after the Gateway-only UI cleanup. |
| Gateway frontend build | `pass` | `cd gateway/frontend && npm run build` passed. |
| Gateway browser/runtime verify | `pass` | `cd gateway/frontend && npm run verify` starts `emwaver gateway serve --sim-device`, checks `/health`, frontend assets, `/v1/examples`, Rust Agent route absence, WebSocket `script.run`, `ui.snapshot`, `ui.event`, and rejects runtime-owner roles. |
| Rust Gateway build | `pass` | `cd gateway/backend && cargo build -p emwaver` passed. |
| Rust runtime/device tests | `pass` | `cd gateway/backend && cargo test -p emwaver-runtime -p emwaver-device` passed. |
| Gateway simulator validation | `pass` | `scripts/rebirth-gateway-sim-validation.sh` starts the built Gateway with `--sim-device` and verifies script rendering plus UI event dispatch through `/v1/ws`. |
| Install smoke | `pass` | `scripts/rebirth-install-smoke.sh` installs into a temporary prefix, verifies the packaged CLI/assets, starts installed `emwaver gateway serve --sim-device`, and verifies script rendering plus UI event dispatch. |

## CLI Contract

| Test | Status | Evidence |
| --- | --- | --- |
| Help surface | `pass` | `cargo run -q -p emwaver -- --help` exposes `gateway`, `service`, `tui`, `devices`, `doctor`, `run`, `wifi`, and `paths`, with no removed command groups. |
| Gateway subcommands | `pass` | `cargo run -q -p emwaver -- gateway --help` exposes `start`, `serve`, `stop`, `status`, and `autostart`. |
| Offline run behavior | `pass` | `emwaver run <script.emw> --port 4999` fails clearly with `failed to connect to local gateway`. |
| Gateway-backed run | `pass` | `emwaver gateway serve --sim-device --port 4998` plus `emwaver run <script.emw> --port 4998` returned `started hello.emw`; `npm run verify` and `scripts/rebirth-gateway-sim-validation.sh` verify `script.started` and `ui.snapshot`. |

## Native Apps

| Platform | Status | Evidence |
| --- | --- | --- |
| macOS | `build pass` | `xcodebuild -quiet -project macos/EMWaver/EMWaver.xcodeproj -scheme EMWaver -configuration Debug build` passed after Gateway host startup, settings, overlay UI, and `RemoteControlHostService.swift` were removed. Native runtime, firmware update, Wi-Fi setup, local scripts, Agent UI, and renderers remain app-local. |
| Windows | `source pass / build blocked here` | Gateway host startup, settings, `RemoteControlHostService.cs`, and related script mirror code were removed. Local build requires a Windows/.NET/WinUI workstation; `dotnet` is not installed on this machine. |
| iOS/Android | `not affected` | Mobile apps remain self-contained native device-control surfaces. |

## Agent Boundary

| Test | Status | Evidence |
| --- | --- | --- |
| Rust backend Agent removal | `pass` | Rust Gateway does not expose an Agent HTTP route; the frontend verifier expects `404`. |
| CLI Agent removal | `pass` | The Rust Agent command is no longer a public CLI command. |
| Product direction | `pass` | Agent UI/tooling belongs in TypeScript/client code and app-native Agent surfaces; Rust remains focused on local device/backend communication. |

## Hardware Repos

| Test | Status | Evidence |
| --- | --- | --- |
| Hardware import | `pass` | The nine primary hardware repos are imported under `hardware/<repo-name>/` paths with subtree history. |

## Manual Hardware Validation Still Needed

- Real ESP32-S3 LAN script execution through `emwaver gateway serve --wifi <host>`.
- VPN/private-IP ESP32 Wi-Fi execution.
- USB/MIDI selected-device execution on macOS, Linux, and Windows.
- BLE execution on a real ESP32 class board after the Gateway consolidation lands.

## Validation Rules

- Do not treat simulator validation as proof of real hardware execution.
- Do not treat browser UI preview as proof of real hardware execution.
- Do not mark hardware validation complete until a real supported board runs the script through the intended transport.
