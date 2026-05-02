# EMWaver Rebirth Validation

This file tracks validation for the local-first rebirth work.

It complements `TESTS.md`, which remains the manual hardware test suite.

## Gateway Prototype

| Test | Status | Evidence |
| --- | --- | --- |
| `gateway npm ci` | `pass` | `npm ci` completed with 0 vulnerabilities. |
| `gateway typecheck` | `pass` | `npm run typecheck` completed successfully. |
| `gateway /health` | `pass` | `GET http://127.0.0.1:3921/health` returned `{"ok":true,"service":"emwaver-gateway"}`. |
| `gateway ws script.run` | `pass` | WebSocket to `/v1/ws` returned `hello.ack`, `device.status`, `script.started`, and `ui.snapshot` for `UI.render(UI.text({ text: "hello" }))`. |
| `gateway verify` | `pass` | `npm run verify` passed after the plot bridge update, including typecheck, `/health`, `/v1/examples`, `/v1/agent` missing-key behavior, configured mock Agent forwarding, and browser -> mock native app -> browser WebSocket `script.run` -> `ui.snapshot`, `plot.viewport` -> `plot.data`, plus `ui.event` -> `ui.event.ack`. |
| Gateway local plot support | `pass` | Gateway renders `plot` nodes as local SVG charts, sends `plot.viewport`, stores returned `plot.data`, and supports pan/zoom in the localhost UI. `npm run verify` covers the protocol route. |
| Gateway bundled UI node coverage | `pass` | Local renderer now supports the UI node types used by bundled examples: `column`, `row`, `grid`, `text`, `button`, `tile`, `slider`, `picker`, `textField`, `textEditor`, `scroll`, `card`, `divider`, `spacer`, `progress`, `logViewer`, and `plot`. `npm run verify` parses the embedded browser script and passes. |
| Gateway local UI guard | `pass` | `npm run verify` checks the index page for local Open/Save/native-app/Agent markers and rejects hosted auth/cloud file route markers. |
| Gateway local device status UI | `pass` | Sidebar now renders local native-app/device status from `device.status`; `npm run verify` still passes. |
| Gateway local files UI | `pass` | Gateway editor has browser-local `.emw` open/save controls; `npm run verify` still passes. |
| Gateway CI workflow | `added` | `.github/workflows/gateway-ci.yml` runs `npm ci` and `npm run verify` for gateway changes. |

## CLI

| Test | Status | Evidence |
| --- | --- | --- |
| Rust toolchain preflight | `pass` | `./scripts/check-rust-toolchain.sh` reports Cargo/Rust available after Homebrew Rust install. |
| Rust CLI build | `pass` | `cd daemon && cargo build -p emwaver-host -p emwaver` completed successfully. |
| Daemon CI workflow | `pass` | GitHub Actions run `25249058504` passed: Rust preflight, `cargo test -p emwaver-runtime -p emwaver-device`, `cargo build -p emwaver-host -p emwaver`, and a UI-only `emwaver run --direct --no-device` smoke test. |
| Runtime/device crate extraction | `pass` | `emwaver-runtime` and `emwaver-device` are workspace crates consumed by `emwaver-host`; `cargo build -p emwaver-host -p emwaver` passed. |
| Runtime command bridge | `pass` | `emwaver-runtime` defines `CommandBridge`, no longer depends on `emwaver-device`, and `cargo test -p emwaver-runtime` passed with render, packet bridge, script error, UI callback dispatch, and unknown-handler coverage. |
| Selected device API | `build pass` | `emwaver-device::Device::connect_by_id()` and `emwaver daemon start --device-id <id>` compile; hardware behavior still needs a connected board. |
| `emwaver tui` rebirth decision | `doc pass` | TUI remains daemon/status-oriented for the rebirth; script-aware terminal UI is deferred until local CLI/gateway hardware execution is validated. |
| `emwaver doctor` | `pass` | `cargo run -q -p emwaver -- doctor` passed: reports platform, local state paths, autostart status, gateway package, Node/npm, Cargo/Rust availability, and MIDI visibility; no MIDI ports found on this machine. |
| `emwaver devices` shared layer | `pass` | CLI device listing uses `emwaver_device::list_devices()` and is covered by the Rust CLI build plus `doctor` device visibility check. |
| `emwaver run` | `pass` | `cargo run -q -p emwaver -- run <temp>.emw --port 3938 --timeout-ms 12000` returned `started ...` through local gateway plus built macOS app. |
| `emwaver run --direct --no-device` | `pass` | UI-only script ran through the extracted Rust runtime and printed an app-shaped `ui.snapshot` without gateway, cloud, daemon, or hardware. |
| `emwaver run` script error reporting | `pass` | A direct UI-only script containing `throw new Error("rebirth cli failure")` exits nonzero and prints `Error: script eval failed` with cause `Error: rebirth cli failure`. |
| `emwaver run --direct --device` validation | `pass` | Invalid `--device abc` returns `invalid MIDI input port id`; `--device 0 --no-device` returns `--device cannot be combined with --no-device`. Hardware-backed selected-device behavior still needs a connected board. |
| `emwaver gateway --port` | `pass` | With `gateway/node_modules` removed, `cargo run -q -p emwaver -- gateway --port 3940` ran `npm ci`, started the gateway, and `/health` returned the gateway service payload. |
| `emwaver agent` missing key | `pass` | With Agent env unset, command exits with `agent_not_configured` setup guidance. |
| `emwaver agent` configured mock | `pass` | Local mock endpoint received Bearer auth and script context, and CLI printed returned message/code. |

## Hardware Repos

| Test | Status | Evidence |
| --- | --- | --- |
| Local hardware repo inventory | `pass` | Repos found under `/Users/luisml/Documents/emwaver/`, all git repos on `main` with `continualmi` remotes. |
| Hardware import script dirty guard | `pass` | `./hardware/import-subtrees.sh` refused to run in a dirty worktree before creating subtree commits. |
| Trial hardware import | `pass` | `./hardware/import-subtrees.sh gpio-waver` imported `gpio-waver` with history in commit `4f45903a`; the repo now lives at `hardware/gpio-waver/`. |
| Full hardware import | `pass` | `./hardware/import-subtrees.sh all` imported the remaining eight repos as subtree commits and skipped existing `hardware/gpio-waver/`. |

## Platform Device Access

| Platform | Status | Notes |
| --- | --- | --- |
| macOS | `build pass` | `xcodebuild -project macos/EMWaver/EMWaver.xcodeproj -scheme EMWaver -configuration Debug -sdk macosx build` succeeded after the ESP helper wrapper fallback was added. Runtime/hardware validation is still pending. |
| macOS local runtime account gate | `build pass` | `ContentView` now passes the connected `MacUSBManager` into `ScriptsRootView` whenever USB is connected, without requiring `AccountDevicesService.hasOfflineAccess(...)`; Debug macOS build succeeded. |
| Rebirth hardware validation helper | `tool pass / hardware skipped` | `scripts/rebirth-hardware-validation.sh` builds the CLI, runs `doctor`, lists devices, and verifies UI-only direct runtime. On this machine it reported no MIDI ports and skipped hardware direct runtime until `EMWAVER_DEVICE_ID` is provided. |
| Windows local runtime account gate | `source pass / build blocked` | `ScriptsPage` script runtime sends packets through `AppServices.Device` directly and does not consult `AccountDevicesService.HasOfflineAccess(...)`; device-page copy now treats account cache as optional. Build remains blocked here because `dotnet`/Windows toolchain is unavailable. |
| Windows validation runbook | `added / blocked` | `scripts/rebirth-windows-validation.ps1` documents the Windows restore/build, local gateway app-role, and hardware checks. It must be run on a Windows workstation with the required .NET/WinUI SDK and hardware. |
| Linux validation runbook | `added / blocked` | `scripts/rebirth-linux-validation.sh` records Linux ALSA/USB diagnostics and calls the generic hardware validation helper. It degrades cleanly on macOS but must be rerun on Linux with a visible board. |
| Linux | `pending` | Validate on a Linux machine with ALSA MIDI device permissions, Cargo/toolchain installed, and a supported board connected. |
| Windows | `pending` | Validate USB/MIDI visibility through the Windows app/CLI environment. |
| `emwaver run` source path | `pass` | Built and verified through local gateway plus built macOS app. |
| `emwaver doctor` source path | `pass` | Built and verified locally. |
| macOS local gateway app role | `pass` | Local gateway plus built macOS app returned `hello.ack`, `device.status`, `script.started`, and `ui.snapshot` for a UI-only `.emw` script through `/v1/ws`. Hardware-backed script execution remains pending. |
| Windows local gateway app role | `blocked` | `RemoteControlHostService.cs` connects to localhost gateway as `role=app` and activates snapshots on `script.run`; local validation blocked because `dotnet`/Windows toolchain are not installed here. |

## Validation Rules

- Do not treat TypeScript UI preview as proof of real hardware execution.
- Do not treat `emwaver run` UI-only validation as proof of real hardware execution.
- Do not mark local gateway hardware control complete until the native app executes hardware-backed scripts through the local gateway bridge.
- Hardware monorepo import is complete for the nine primary repos; catalog cleanup for older/generated hardware IDs remains separate follow-up work.
