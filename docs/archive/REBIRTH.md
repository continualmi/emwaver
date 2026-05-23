# EMWaver Rebirth Plan

EMWaver's rebirth is a local-first, open-source electronics platform direction. Local hardware control must work without EMWaver accounts, cloud activation, hosted relay, subscription checks, or cloud script storage.

## Product Model

```text
CLI -> Gateway -> device
browser -> Gateway -> device
native apps -> self-contained native runtime -> device
```

Gateway is the terminal/browser stack under `gateway/`. It owns the Rust backend, CLI, runtime, transports, install/service helpers, and React browser frontend for localhost workflows.

Native macOS, Windows, iOS, and Android apps remain self-contained device-control applications. They may share assets and protocol ideas, but they do not act as Gateway-controlled runtime hosts.

## Business Model

- Open-source local core: runtime, Gateway, CLI, scripts, firmware payloads, and hardware support.
- Paid Agent API usage through Continual MI/MGPT.
- No EMWaver accounts or hosted activation for local hardware access.
- No cloud script storage or sync by default.

## Platform Priorities

1. Finish Gateway consolidation under `gateway/MIGRATION.md`.
2. Keep local `.emw` script execution fast and account-free.
3. Preserve managed firmware/update flows where practical so users do not build firmware manually.
4. Validate USB/MIDI, BLE, and ESP32 Wi-Fi transports on real hardware.
5. Build toward a multi-device automation bench for agent-driven hardware validation.
6. Keep Agent prompts, routing, and metering in the future Continual MI/MGPT backend; clients send user intent and approved local context.

## Launch Scope

Minimum launch proves:

- local script execution through native apps and Gateway,
- supported board setup/update flows,
- browser UI served by localhost Gateway,
- CLI script execution through a running Gateway,
- local-first ESP32 Wi-Fi LAN/VPN posture,
- optional Agent positioning that does not gate local control,
- hardware repos consolidated under `hardware/`.

## Non-Goals

- Hosted relay or cloud fleet control.
- Account-gated local hardware access.
- Cloud script storage as a default path.
- Native apps acting as Gateway runtime hosts.
- End-user MCU toolchain workflows for normal use.
