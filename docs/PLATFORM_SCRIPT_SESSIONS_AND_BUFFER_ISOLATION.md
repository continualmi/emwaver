# Platform Script Sessions and Buffer Isolation

Status: in progress after macOS multi-device session work.

## Goal

Windows, Android, and iOS should follow the macOS direction for local script runs:

- a visible target device before Run,
- running-script status in the scripts list,
- a row-level stop control for the running session,
- no normal "Stop and Run" replacement prompt,
- and host-side buffer isolation per target device before true multi-device concurrency is advertised.
- transport code split into USB, BLE, and Wi-Fi units instead of growing monolithic device managers.

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

macOS is also moving away from one large USB manager file toward separate USB MIDI, BLE, and Wi-Fi transport implementations. The other native platforms should follow that direction as they gain multi-device support. The desired ownership boundary is:

- a transport discovers and connects devices,
- each connected device gets a transport-owned session object,
- that session owns its parser, command wait state, sampler state, RX/TX logs, and capture buffer,
- the script runtime gets only a target-scoped bridge into that session.

## Windows direction

Current first step:

- scripts list shows the active run as a session row,
- the session row shows the active device label when available,
- the Windows session row now reads the connected port's `DisplayName`, so USB MIDI rows show the actual target label instead of falling back to transport text.
- the session row has a stop button,
- running a different script no longer shows the old "Stop and Run" switch prompt.
- the Windows session-row and toolbar stop controls now stop the active script directly, matching the simplified macOS row-control behavior.
- active transport buffer state is now represented by a `DeviceBufferSession` instead of direct script-runtime reads from the process-wide buffer facade.
- Windows USB and BLE connections now select keyed buffer sessions, matching the macOS target-session direction even though only one transport connection is active at a time today.
- Windows script sampler packet APIs now use the transport lane size exposed by `NativeBufferRust.PacketSizeBytes` instead of assuming 64-byte packets.
- Windows command response wait state now lives on the active `DeviceBufferSession` instead of singleton fields on `WindowsDeviceManager`.
- Windows SysEx parser accumulator and lane demux now live on the active `DeviceBufferSession`, including BLE notification chunk reassembly.

Remaining isolation work:

- finish moving debug/monitor and transport helpers off the `NativeBufferRust` process-wide facade,
- route script engines through a targeted device/session bridge,
- keep sampler stream state and capture buffers scoped to that device session.
- split `WindowsDeviceManager` into USB MIDI, BLE, and future Wi-Fi transport units with a shared device/session contract.

## Android direction

Current first step:

- script rows show "Running on active device" for the current run,
- Android now captures the active USB/BLE connection label when a script starts and shows that label in the running script row when available.
- the running row has a stop button,
- leaving preview can keep the run visible in the list rather than making the list look idle.
- `USBService` now routes script-facing capture buffers through a `DeviceBufferSession` instance instead of direct reads/writes to the process-wide `NativeBuffer` facade.
- Android USB and BLE connections now select keyed buffer sessions, matching the Windows/macOS direction even though only one transport session is active at a time today.
- Android script sampler packet APIs now use the active bridge packet size instead of assuming 64-byte packets.
- Android sampler stream lane policy state now lives on the active `DeviceBufferSession` instead of singleton fields on `USBService`.
- Android command response wait cursor/polling now lives on the active `DeviceBufferSession` instead of inline state in `USBService`.
- Android SysEx parser accumulator and lane demux now live on the active `DeviceBufferSession` instead of singleton fields on `USBService`.
- Android captures the active device service into `ScriptDeviceConnection` when a local script starts, so script I/O no longer re-resolves whichever service is active later.

Remaining isolation work:

- replace `USBService`'s process-wide `NativeBuffer` usage with a per-device session store,
- extend `DeviceConnectionService` / `ScriptDeviceBridge` with target-device routing,
- keep remaining capture ownership scoped to that target session.
- split USB, BLE, and future Wi-Fi connection code into transport-specific services that expose the same session contract.

## iOS direction

iOS already uses the shared SwiftUI scripts surface, so list-level session display now uses the same `ScriptsRootView.ScriptSessionStatus` hook as macOS. Because iOS still has one singleton transport buffer, the current native path keeps one active visible local session and replaces that runtime without a stop-and-run prompt. Multi-device concurrency stays gated on target-scoped buffer state.

Current first step:

- `USBManager` now routes script-facing capture buffer reads/writes through a `DeviceBufferSession` object instead of direct stateful access to the `NativeBufferRust` process-wide facade.
- iOS USB MIDI and BLE connections now select keyed buffer sessions, matching the Windows/Android/macOS direction even though only one transport session is active at a time today.
- the shared Apple script runtime now derives sampler packet slicing from `ScriptDevice.bufferPacketSizeBytes()` instead of assuming 64-byte packets.
- iOS sampler stream lane policy state now lives on the active `DeviceBufferSession` instead of singleton fields on `USBManager`.
- iOS command response wait cursor/polling now lives on the active `DeviceBufferSession` instead of inline state in `USBManager`.
- iOS SysEx parser accumulator and lane demux now live on the active `DeviceBufferSession` instead of singleton fields on `USBManager`.
- iOS captures the active transport session key when a local script starts and routes script buffer/command APIs through that keyed session.

Remaining isolation work:

- split `USBManager`'s single `NativeBufferRust` state into target-scoped sessions,
- route remaining buffer APIs through the selected target session.
- split `USBManager` into USB MIDI, BLE, and future Wi-Fi transport files that publish a shared connected-device/session model.

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
- [x] Windows has an active transport buffer session object used by script sampler reads.
- [x] Windows selects keyed USB/BLE buffer sessions instead of a single process-wide script buffer.
- [x] Windows scopes command response wait state to the active transport buffer session.
- [x] Windows scopes SysEx parser state to the active transport buffer session.
- [x] Android has an active transport buffer session object used by script sampler reads.
- [x] Android selects keyed USB/BLE buffer sessions instead of a single process-wide script buffer.
- [x] Android scopes sampler stream state to the active transport buffer session.
- [x] Android scopes command response wait state to the active transport buffer session.
- [x] Android scopes SysEx parser state to the active transport buffer session.
- [x] Android binds local script runs to the active device service captured at run start.
- [x] iOS has an active transport buffer session object used by script sampler reads.
- [x] iOS selects keyed USB/BLE buffer sessions instead of a single process-wide script buffer.
- [x] iOS scopes sampler stream state to the active transport buffer session.
- [x] iOS scopes command response wait state to the active transport buffer session.
- [x] iOS scopes SysEx parser state to the active transport buffer session.
- [x] iOS binds local script runs to the active transport session key captured at run start.
- [ ] Windows has per-device host buffer/session state.
- [ ] Android has per-device host buffer/session state.
- [ ] iOS has per-device host buffer/session state.
- [ ] Windows USB/BLE/Wi-Fi transport code is split behind a shared session contract.
- [ ] Android USB/BLE/Wi-Fi transport code is split behind a shared session contract.
- [ ] iOS USB/BLE/Wi-Fi transport code is split behind a shared session contract.
- [ ] Windows can safely run two hardware scripts against two devices without shared buffer contamination.
- [ ] Android can safely run two hardware scripts against two devices without shared buffer contamination.
- [ ] iOS can safely run two hardware scripts against two devices without shared buffer contamination.
