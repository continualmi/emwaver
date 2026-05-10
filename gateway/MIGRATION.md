# Gateway Consolidation Migration

This file controls the migration that makes `gateway/` the single owner of EMWaver's local backend, CLI, runtime, transports, and browser frontend.

## Goal

`gateway/` becomes the local hardware-control stack:

```text
gateway/
  backend/    Rust Gateway service, emwaver CLI, runtime, transports, install/service helpers
  frontend/   React browser UI, frontend build scripts, static assets
```

The public model is:

```text
CLI -> Gateway -> device
browser -> Gateway -> device
native apps -> self-contained native runtime -> device
```

There is no background-service product surface under the old name, no direct/local CLI execution mode, and no native app control path from Gateway.

## Non-Negotiable Decisions

- Use **Gateway** for the local service name.
- Keep the binary name `emwaver`.
- Move all Rust CLI/backend/runtime/transport code from the old top-level Rust workspace to `gateway/backend/`.
- Move the browser UI into `gateway/frontend/`.
- Remove the old service command group and old service terminology from active product docs.
- Remove the old direct-run flag; `emwaver run` requires a running Gateway.
- Remove native app Gateway runtime-owner control and related macOS/Windows settings.
- Remove separate Gateway broker behavior; the Rust Gateway backend serves the frontend and owns `/v1/ws`.
- Do not keep backwards-compatible aliases for removed commands or flags.
- Keep Agent UI and tooling in TypeScript/client code. Rust owns local device/backend communication only.

## Target Commands

```bash
emwaver gateway serve
emwaver gateway serve --device 0
emwaver gateway serve --ble
emwaver gateway serve --wifi 192.168.1.44 --wifi-port 3922
emwaver gateway serve --no-device
emwaver gateway serve --sim-device

emwaver gateway start
emwaver gateway stop
emwaver gateway status

emwaver run scripts/blink.emw
emwaver devices
emwaver doctor
```

Removed command surfaces include the old background-service group, standalone stack starter, Node web wrapper, direct-run flag, fallback flag, and Rust Agent command.

## Protocol Boundary

Gateway owns the existing local JSON WebSocket protocol directly.

Inbound:

```text
hello
script.run
script.stop
ui.event
plot.viewport
```

Outbound:

```text
hello.ack
device.status
script.started
script.stopped
script.error
ui.snapshot
plot.data
```

`hello.role` is informational for client labels such as `cli` and `web`. Runtime-owner roles such as `app` and `host` must be removed.

## Migration Checklist

### 1. Layout

- [x] Create `gateway/backend/` Rust workspace.
- [x] Move Rust CLI crate to `gateway/backend/emwaver/`.
- [x] Move Rust runtime crate to `gateway/backend/emwaver-runtime/`.
- [x] Move Rust transport crate to `gateway/backend/emwaver-device/`.
- [x] Move install/service helpers to `gateway/backend/install/`.
- [x] Move current frontend files into `gateway/frontend/`.
- [x] Delete the old top-level runtime workspace directory.
- [x] Remove old terminology and command surfaces from the moved backend code.

### 2. Backend

- [x] Make Rust Gateway serve frontend assets and HTTP endpoints from one process.
- [x] Move `/health`, `/v1/ws`, `/v1/devices`, and local control behavior into the Rust backend.
- [x] Remove the Rust Agent endpoint and CLI; Agent UI/tooling belongs in TypeScript/client code.
- [x] Remove the Node WebSocket broker from runtime use.
- [x] Keep Node/Vite only for frontend builds.
- [x] Rename state files and service artifacts from old service names to gateway names.

### 3. CLI

- [x] Replace old service commands with `gateway start|serve|stop|status|autostart`.
- [x] Make `emwaver run` connect to a running Gateway only.
- [x] Remove direct/local script execution mode from public CLI.
- [x] Keep simulator/no-device support only as Gateway startup transport modes.
- [x] Keep TUI as a Gateway-status client surface, not a runtime owner.

### 4. Native Apps

- [x] Remove macOS Gateway host startup and settings.
- [x] Remove Windows Gateway host startup and settings.
- [x] Update native app docs so native apps are self-contained runtimes, not Gateway backends.
- [x] Keep native Wi-Fi setup, firmware update, local scripts, Agent UI, and native renderers intact.

### 5. Docs, CI, Packaging

- [x] Update `AGENTS.md`, root `README.md`, `docs/PLANNING.md`, `docs/LAUNCH_MVP.md`, `docs/PACKAGING.md`, and validation trackers.
- [x] Rename old service-oriented scripts/workflows to Gateway-oriented names.
- [x] Update release packaging to ship `emwaver` plus Gateway frontend assets from `gateway/`.
- [x] Update tests so no verifier depends on native app mocks, runtime-owner roles, the old direct-run flag, or the old fallback flag.

## Completion Gates

- [x] Stale active product/runtime references to old service names, direct mode, native app Gateway roles, and Rust Agent control are removed.
- [x] `emwaver --help` exposes Gateway terminology only.
- [x] `emwaver run <script.emw>` fails clearly when Gateway is offline.
- [x] `emwaver gateway serve --sim-device` plus `emwaver run <script.emw>` returns `script.started`; verifier coverage confirms `ui.snapshot`.
- [x] Browser UI render, UI event dispatch, plot viewport, and device status work through the Rust Gateway backend.
- [x] macOS and Windows no longer start or expose Gateway host control.
- [x] Gateway browser status is non-invasive: it reports cached Gateway-owned transport state and does not open competing device probe sessions.
- [x] Gateway device lists expose physical devices only after a successful local hardware UID read.
- [x] Gateway polls USB MIDI, BLE, and Wi-Fi together; selected device/transport settings are persisted locally.

## Current Status

Status: code migration complete; Gateway multi-transport device selection alignment complete.

Completed so far:

- Rust CLI/runtime/transport crates moved to `gateway/backend/`.
- Browser frontend package moved to `gateway/frontend/`.
- The old top-level runtime workspace directory was removed.
- Rust Gateway serves frontend assets, HTTP endpoints, WebSocket protocol, and runtime ownership in one process.
- Browser status and `/v1/devices` use Gateway-owned multi-transport state while the Gateway is running, avoiding extra browser-triggered USB/BLE/Wi-Fi probe sessions.
- `emwaver devices` reads Gateway state; Gateway is required for CLI/browser device control.
- Gateway settings persist the selected UID and transport preference. Transport auto-selection uses USB, then BLE, then Wi-Fi.
- Direct CLI runtime, native app Gateway host control, Node broker runtime, and Rust Agent surfaces were removed.
- Active docs, skills, scripts, workflows, and parity manifests now describe the Gateway-only contract.
- `cargo fmt --check`, `cargo build -q -p emwaver`, and `cargo test -q -p emwaver-runtime -p emwaver-device` pass from `gateway/backend/`.
- `npm run typecheck`, `npm run build`, and `npm run verify` pass from `gateway/frontend/`.
- `scripts/rebirth-gateway-sim-validation.sh` and `scripts/rebirth-install-smoke.sh` pass.
- macOS Debug app build passes; Windows source cleanup is done but local build is blocked by missing `dotnet`/Windows toolchain.

Remaining blockers:

- Real hardware validation for USB/MIDI, BLE, and ESP32 Wi-Fi remains separate from this migration.
- Windows native compile validation must run on a Windows/.NET/WinUI workstation.
