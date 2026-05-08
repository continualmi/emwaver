# Platform Script Sessions and Buffer Isolation

Status: in progress after macOS multi-device session work.

## Goal

Windows, Android, and iOS should follow the macOS direction for local script runs:

- a visible target device before Run,
- running-script status in the scripts list,
- a row-level stop control for the running session,
- no normal "Stop and Run" replacement prompt,
- and host-side buffer isolation per target device before true multi-device concurrency is advertised.

## macOS reference behavior

macOS now routes a script run through a target-specific bridge. The selected device id is captured when a script session starts, and the bridge calls the `MacUSBManager` APIs with that device id.

`MacUSBManager` resolves that id to a per-device `MacTransportDeviceSession`. Each device session owns:

- capture buffer,
- RX packet queue,
- USB MIDI sysex accumulator,
- sampler streaming state,
- command response semaphore and predicate,
- command lock.

That is the bar for the other native hosts. Multiple visible sessions are not enough if they still share one capture buffer or one response queue.

## Windows direction

Current first step:

- scripts list shows the active run as a session row,
- the session row shows the active device label when available,
- the session row has a stop button,
- running a different script no longer shows the old "Stop and Run" switch prompt.

Remaining isolation work:

- move `NativeBufferRust` access out of global use in `WindowsDeviceManager`,
- introduce a per-device session object equivalent to `MacTransportDeviceSession`,
- route script engines through a targeted device/session bridge,
- keep response wait state, parser state, sampler stream state, and capture buffers scoped to that device session.

## Android direction

Current first step:

- script rows show "Running on active device" for the current run,
- the running row has a stop button,
- leaving preview can keep the run visible in the list rather than making the list look idle.

Remaining isolation work:

- replace `USBService`'s process-wide `NativeBuffer` usage with a per-device session store,
- extend `DeviceConnectionService` / `ScriptDeviceBridge` with target-device routing,
- bind each script run to a target service/session,
- keep sampler stream state and command response state scoped to that target session.

## iOS direction

iOS already uses the shared SwiftUI scripts surface, so list-level session display now uses the same `ScriptsRootView.ScriptSessionStatus` hook as macOS. Because iOS still has one singleton transport buffer, the current native path keeps one active visible local session and replaces that runtime without a stop-and-run prompt. Multi-device concurrency stays gated on target-scoped buffer state.

Remaining isolation work:

- split `USBManager`'s single `NativeBufferRust` state into target-scoped sessions,
- add a target-aware script-device bridge instead of attaching scripts directly to the singleton `USBManager`,
- route buffer APIs, command waits, packet parsing, and sampler stream state through the selected target session.

## Acceptance checklist

- [x] macOS shows selected local device before Run.
- [x] macOS creates separate visible script sessions.
- [x] macOS targets script device APIs to the selected device id.
- [x] macOS has per-device host buffer/session state.
- [x] Windows shows active run status in the script list.
- [x] Windows has a row-level stop control for the active run.
- [x] Android shows active run status in the script list.
- [x] Android has a row-level stop control for the active run.
- [x] iOS shows active run status in the shared scripts list.
- [x] iOS has a row-level stop control for the active run through the shared scripts row.
- [ ] Windows has per-device host buffer/session state.
- [ ] Android has per-device host buffer/session state.
- [ ] iOS has per-device host buffer/session state.
- [ ] Windows can safely run two hardware scripts against two devices without shared buffer contamination.
- [ ] Android can safely run two hardware scripts against two devices without shared buffer contamination.
- [ ] iOS can safely run two hardware scripts against two devices without shared buffer contamination.
