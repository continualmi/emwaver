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
| `gateway verify` | `pass` | `npm run verify` passed after the native-app bridge update, including typecheck, `/health`, `/v1/examples`, `/v1/agent` missing-key behavior, configured mock Agent forwarding, and browser -> mock native app -> browser WebSocket `script.run` -> `ui.snapshot` plus `ui.event` -> `ui.event.ack`. |
| Gateway local UI guard | `pass` | `npm run verify` checks the index page for local Open/Save/native-app/Agent markers and rejects hosted auth/cloud file route markers. |
| Gateway local device status UI | `pass` | Sidebar now renders local native-app/device status from `device.status`; `npm run verify` still passes. |
| Gateway local files UI | `pass` | Gateway editor has browser-local `.emw` open/save controls; `npm run verify` still passes. |
| Gateway CI workflow | `added` | `.github/workflows/gateway-ci.yml` runs `npm ci` and `npm run verify` for gateway changes. |

## CLI

| Test | Status | Evidence |
| --- | --- | --- |
| Rust toolchain preflight | `pass` | `./scripts/check-rust-toolchain.sh` reports Cargo/Rust available after Homebrew Rust install. |
| Rust CLI build | `pass` | `cd daemon && cargo build -p emwaver-host -p emwaver` completed successfully. |
| Runtime/device crate extraction | `pass` | `emwaver-runtime` and `emwaver-device` are workspace crates consumed by `emwaver-host`; `cargo build -p emwaver-host -p emwaver` passed. |
| Runtime command bridge | `pass` | `emwaver-runtime` defines `CommandBridge`, no longer depends on `emwaver-device`, and `cargo test -p emwaver-runtime` passed with render, packet bridge, script error, UI callback dispatch, and unknown-handler coverage. |
| Selected device API | `build pass` | `emwaver-device::Device::connect_by_id()` and `emwaver daemon start --device-id <id>` compile; hardware behavior still needs a connected board. |
| `emwaver doctor` | `pass` | `cargo run -q -p emwaver -- doctor` passed: gateway package, Node/npm, Cargo/Rust available; no MIDI ports found. |
| `emwaver devices` shared layer | `pass` | CLI device listing uses `emwaver_device::list_devices()` and is covered by the Rust CLI build plus `doctor` device visibility check. |
| `emwaver run` | `pass` | `cargo run -q -p emwaver -- run <temp>.emw --port 3938 --timeout-ms 12000` returned `started ...` through local gateway plus built macOS app. |
| `emwaver run --direct --no-device` | `pass` | UI-only script ran through the extracted Rust runtime and printed an app-shaped `ui.snapshot` without gateway, cloud, daemon, or hardware. |
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
| Linux | `pending` | Validate on a machine with device permissions and Cargo/toolchain installed. |
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
