# EMWaver Device Simulator

This document defines the development goal for a reusable EMWaver mock device simulator.

## Goal

EMWaver should be testable without a physical board.

The simulator should let every platform run hardware-touching `.emw` scripts in unit or integration tests while sharing the same expected device behavior.

Target consumers:

- macOS and iOS Swift runtime tests,
- Windows C# runtime tests,
- Android Kotlin runtime tests,
- future MCP/tool-facing evals for generated scripts.

## Architecture

The first simulator layer should sit behind the platform command bridge, not behind a fake OS device driver.

```text
.emw script/runtime
  -> platform command bridge/test double
  -> shared simulator scenario
  -> deterministic mock board state
```

This keeps the simulator portable across macOS, Windows, iOS, Android, and CI environments.

The first implementation should be protocol-level. It should emulate command replies that real firmware would return for the APIs exposed by `script_bootstrap.emw`.

## Shared Fixtures

Use data-driven scenarios where practical so every platform can reuse the same cases.

Suggested fixture shape:

```text
simulator/
  README.md
  fixtures/
    basic-board.json
    gpio-loopback.json
    adc-ramp.json
    bus-stubs.json
```

The initial fixture path is `simulator/fixtures/basic-board.json`.

Fixtures should describe:

- board type and firmware metadata,
- GPIO pin capabilities and current state,
- ADC channel values or deterministic sequences,
- PWM-capable pins and last written values,
- SPI/I2C/UART stub replies,
- expected errors for unsupported operations.

## Protocol Coverage

Initial coverage should include:

- device identity and board metadata,
- GPIO mode/read/write/pull/info,
- ADC reads,
- PWM start/write/stop,
- minimal SPI/I2C/UART transfer stubs,
- explicit unsupported-command errors.

Each platform exposes a simulator bridge that reads the shared fixture JSON and provides a `sendPacket`-compatible delegate for its native script engine:

- Apple platforms (macOS/iOS): `SimulatorScriptDevice` (Swift)
- Windows: `Scripting/SimulatorCommandBridge.cs` (C#)
- Android: `SimulatorScriptDeviceBridge` (Kotlin)

## Non-Goals

- Replacing real hardware validation.
- Simulating analog electronics perfectly.
- Building a fake USB/MIDI/serial driver as the first step.
- Hiding firmware or runtime bugs behind overly permissive mock behavior.

## Later Option

A virtual MIDI/USB transport simulator can be added later for local end-to-end transport tests, but it is not the portable baseline. The decision is documented in `simulator/VIRTUAL_TRANSPORT.md`.

Any virtual transport must be a second layer that consumes the same simulator scenarios, not a separate source of behavior. It must stay opt-in and must not replace real hardware validation.
