# EMWaver — Current State

This is the contributor orientation doc for the repository as it exists today.

## What EMWaver Is

EMWaver is a local-first, open-source electronics platform by Continual MI. It turns supported MCU boards into a scriptable hardware lab through native apps, managed firmware, JavaScript scripts, script-defined UI panels, and a desktop MCP bridge for MCP clients.

Core idea:

```text
native app -> local script runtime -> USB/BLE/Wi-Fi transport -> supported board firmware -> electronics
```

Scripts are JavaScript files (`.js`). They can use JSX-style syntax inside JavaScript to define native UI panels for connected modules.

Desktop apps expose the running script engine and hardware tools through a local MCP server. Mobile apps keep local script import and app-local execution without hosting an MCP endpoint.

## Supported Platforms

| Platform | Surface | Status |
|----------|---------|--------|
| iOS / iPadOS | Native SwiftUI app | Active; available on the App Store |
| Android | Native Kotlin app | Active; Google Play internal testing and direct APK |
| macOS | Native SwiftUI app | Active; DMG distribution |
| Windows | Native Windows app | Active; installer/ZIP distribution |
| Linux | Native Rust + GTK4/libadwaita app | In progress |

Mobile is the primary product surface. Desktop apps remain important for development, firmware setup, long bench runs, multi-device testing, and advanced workflows.

## Current Architecture

- Native apps own discovery, connection state, script execution, rendered script UI, console output, and firmware/update flows.
- Desktop apps additionally expose a local, user-controlled MCP server so MCP clients can call tools such as `list_scripts`, `run_script`, `device_state`, `spi_transfer`, `gpio_read`, `gpio_write`, and `analog_read`.
- USB is first-class for direct board control.
- BLE supports cable-free mobile sessions where supported by the board.
- Wi-Fi supports LAN/VPN-style network control for boards designed around it.
- STM32 and ESP32-family firmware targets are both part of the platform direction.
- Hardware designs live under `hardware/` and are indexed by `hardware/README.md`.

## Architecture Boundaries

The active architecture is native apps plus the desktop MCP bridge. Browser daemons, hosted relays, and app-side model runtimes are not part of the current local-control path.

## Repo Layout

```text
emwaver/
├── android/          Native Android app
├── ios/              Native iOS/iPadOS app
├── macos/            Native macOS app
├── windows/          Native Windows app
├── linux/            Native Linux app workspace, in progress
├── apple/            Shared Swift package used by iOS and macOS
├── stm/              STM32 firmware workspace
├── esp/              ESP32 firmware workspace
├── firmware/         Bundled firmware payloads per board
├── hardware/         Open hardware designs
├── assets/           Default scripts and shared JS libraries
├── simulator/        Shared simulator fixtures and adapters
├── crates/           Rust firmware/update helper crates
├── tools/            Build and firmware support tooling
├── web/              Public website source
└── docs/             Contributor and planning docs
```

## Documentation Routing

User documentation lives on the website:

- https://emwaver.ai/docs/

Contributor docs in this repo should stay close to the subsystem they describe. Prefer the local folder README for implementation details.

Key contributor docs:

| Doc | Purpose |
|-----|---------|
| `AGENTS.md` | Repo-wide product policies and contribution guardrails |
| `docs/CURRENT.md` | Current-state orientation |
| `docs/PLANNING.md` | Active priorities and next steps |
| `docs/SCHEDULE.md` | Short-term execution tracker |
| `docs/RELEASES.md` | Release workflows and public preview assets |
| `docs/MCP_CONTRACT.md` | Desktop MCP tool contract |
| `docs/LINUX_MACOS_PARITY_AUDIT.md` | Current macOS-vs-Linux native parity checklist |
| `docs/SIMULATOR.md` | Shared simulator direction |
| `docs/parity/` | Cross-platform parity contracts |
| `docs/archive/` | Historical plans and superseded implementation notes |
