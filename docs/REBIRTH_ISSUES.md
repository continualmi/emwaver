# EMWaver Rebirth Issues

This is the durable backlog for the local-first rebirth plan. Keep it concise; detailed implementation notes belong in folder READMEs or the controlling migration document for the active work.

## Active P0

### `REBIRTH-GW-001` Finish Gateway Consolidation

- Target: `gateway/`
- Plan: `gateway/MIGRATION.md`
- Acceptance:
  - `gateway/backend/` owns Rust backend, CLI, runtime, transports, and install/service helper.
  - `gateway/frontend/` owns React browser UI and build/verify scripts.
  - `emwaver run` requires a running Gateway.
  - Native apps do not expose Gateway host services.
  - Rust backend has no Agent command or Agent HTTP route.
  - Active docs and validation scripts describe the new Gateway contract.

### `REBIRTH-GW-002` Validate Gateway On Real Hardware

- Target: USB/MIDI, BLE, ESP32 Wi-Fi.
- Acceptance:
  - Gateway runs a bundled script through a real USB/MIDI board.
  - Gateway runs a bundled script through a real BLE board.
  - Gateway runs a bundled script through an ESP32 Wi-Fi endpoint on the same LAN.
  - Gateway handles busy/disconnect/reconnect states clearly.

### `REBIRTH-GW-003` Define Multi-Device Gateway Sessions

- Target: Gateway runtime/session model.
- Acceptance:
  - Device ids and transport labels are stable.
  - Script commands route to a selected device/session.
  - UI snapshots/events are attributed to their session.
  - Stop/reset does not leak across devices.

## Active P1

### `REBIRTH-ESP32-001` Complete Wi-Fi LAN/VPN Validation

- Target: ESP32-S3 class boards.
- Acceptance:
  - `008_ESP32_WIFI_LAN_SCRIPT_EXECUTION` passes.
  - `009_ESP32_WIFI_VPN_BY_IP_EXECUTION` passes.
  - Remote posture remains user-owned network infrastructure only.

### `REBIRTH-AGENT-001` Reintroduce Browser Agent Tooling In TypeScript

- Target: Gateway frontend/client tooling.
- Acceptance:
  - Agent UI is optional.
  - Missing Agent key never blocks local script execution.
  - Client sends `userInput` and approved local context to the MGPT-facing endpoint.
  - Rust backend remains focused on device/backend communication.

### `REBIRTH-HW-001` Keep Hardware Monorepo Clean

- Target: `hardware/`.
- Acceptance:
  - Imported hardware repos remain under flat `hardware/<repo-name>/` paths.
  - Large/binary asset policy stays documented.
  - Public docs reference canonical hardware assets instead of duplicating them.

## Closed / Superseded

- Browser-to-native app localhost host control is superseded by Gateway-owned terminal/browser runtime.
- In-process/direct CLI runtime execution is superseded by `emwaver run` through a running Gateway.
- Rust Agent command/backend route work is superseded by TypeScript/client Agent tooling and native Agent surfaces.
