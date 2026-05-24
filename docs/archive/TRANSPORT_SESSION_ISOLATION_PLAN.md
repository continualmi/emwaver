# Transport Session Isolation Plan

This plan defines the next multi-device step after Gateway consolidation.

## Goal

Multiple scripts and devices must not share mutable transport/session state by accident. Each connected board needs isolated command response waiters, parser buffers, sampler state, UI revision state, and stop/reset lifecycle.

## Current Runtime Shape

```text
CLI/browser -> Gateway -> transport session -> device
native app -> native transport session -> device
```

Gateway owns terminal/browser sessions. Native apps own their own app-local sessions.

## Required Isolation

- Stable device ids and transport labels.
- One command router per device session.
- One parser/buffer state per transport connection.
- One script runtime state per active script.
- Per-script UI snapshots and event routing.
- Per-device stop/reset behavior.
- Explicit busy/ownership responses when a transport only supports one active client.

## First Implementation Slice

1. Keep one active Gateway runtime session as the default.
2. Make the internal device/session data model explicit even before multi-device UI is complete.
3. Route `script.run`, `script.stop`, and `ui.event` through a selected device/session id.
4. Add simulator coverage for two logical devices.
5. Add real hardware validation with two boards: either two ESP32-S3 BLE devices, or ESP32-S3 BLE plus USB MIDI STM32.

## Validation

- A script running on device A cannot consume replies from device B.
- A stop/reset for device A does not clear device B state.
- UI snapshots identify their script/session source.
- Busy transport behavior is explicit and testable.
- Disconnect/reconnect does not leak stale callbacks or waiters.
