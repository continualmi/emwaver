# Virtual Transport Simulator Decision

`REBIRTH-049` evaluates whether EMWaver should add a fake MIDI/USB transport for end-to-end simulator tests.

## Decision

Do not make a virtual MIDI/USB transport part of the portable simulator baseline.

The protocol-level simulator remains the default test layer for CI, cross-platform runtime tests, and MCP/tool-facing script checks:

```text
.emw script/runtime
  -> platform command bridge/test double
  -> shared simulator fixture
  -> deterministic mock board state
```

A virtual transport may be added later as an optional local integration harness, but it must consume the same `simulator/fixtures/*.json` scenarios and must not define separate device behavior.

## Why

Protocol-level fixtures are portable across macOS, Linux, Windows, iOS, Android, and CI. A fake OS transport is not:

- macOS virtual MIDI depends on user/device configuration such as IAC Driver or a helper app.
- Linux virtual MIDI typically depends on ALSA modules such as `snd-virmidi`, `aconnect`, and host permissions.
- Windows virtual MIDI usually requires a loopback driver or signed virtual MIDI/USB driver stack.
- iOS and Android do not provide a practical app-local fake USB/MIDI device path for normal unit tests.
- GitHub-hosted CI should not depend on kernel modules, privileged driver installation, or platform-specific loopback devices.

## Allowed Future Shape

If added, virtual transport should be a developer-only harness:

```text
real app transport stack
  -> OS loopback MIDI/USB endpoint
  -> simulator transport adapter
  -> SimulatorCommandBridge / shared fixture state
```

Minimum requirements:

- The adapter reads `simulator/fixtures/*.json` or calls the same simulator core used by protocol-level tests.
- It is opt-in and documented as local integration testing.
- It is excluded from required CI and launch gates.
- It never replaces real hardware validation.
- It reports unsupported firmware commands strictly, matching the protocol simulator.

## OS Feasibility

| OS | Feasibility | Notes |
| --- | --- | --- |
| macOS | possible for local MIDI loopback | Can use IAC-style virtual MIDI, but setup is user-machine-specific and not a reliable CI baseline. |
| Linux | possible for local MIDI loopback | ALSA virtual MIDI can work with host permissions; useful for a Linux lab machine, not generic CI. |
| Windows | possible but high-friction | Loopback MIDI is third-party or driver-dependent; fake USB is even heavier. |
| iOS | not practical | App tests should use the Swift `SimulatorScriptDevice` adapter instead. |
| Android | not practical | App tests should use `SimulatorScriptDeviceBridge` instead. |

## Current Baseline

Use these portable paths first:

- Rust: protocol/runtime tests against shared simulator fixtures
- Apple: `SimulatorScriptDevice`
- Windows: `Scripting/SimulatorCommandBridge.cs`
- Android: `SimulatorScriptDeviceBridge`
