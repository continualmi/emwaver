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
- Windows captures the active transport session id when a local script starts and routes script buffer/command APIs through that keyed session.
- Windows USB MIDI/BLE buffering now depends on an `ITransportDeviceSession` contract, giving the future USB/BLE/Wi-Fi split a shared session boundary instead of binding transport code directly to `DeviceBufferSession`.
- Windows BLE transport constants and device-session identity helpers now live in `WindowsBleTransport`, starting the same USB/BLE/Wi-Fi file split direction as macOS without changing connection behavior.
- Windows USB MIDI port pairing, target selection, and session identity helpers now live in `WindowsUsbMidiTransport`, so the current Windows manager has separate USB and BLE transport helper files.
- Windows now has a `WindowsWiFiTransport` boundary with Wi-Fi session/display identity helpers for the future Wi-Fi runtime.
- Windows has a local `DeviceBufferSessionTests` suite covering RX/counter and SysEx parser state isolation across separate transport sessions.
- Windows USB MIDI and BLE receive callbacks now feed SysEx data into the connected transport session instead of always using the mutable active session.
- Windows USB MIDI SysEx message sending now lives in `WindowsUsbMidiTransport`, and BLE chunked GATT writes now live in `WindowsBleTransport`, reducing transport protocol code inside `WindowsDeviceManager`.
- Windows BLE watcher creation, device opening, service/characteristic lookup, and notification descriptor setup now live in `WindowsBleTransport`, further reducing BLE protocol ownership inside `WindowsDeviceManager`.
- Windows USB MIDI device enumeration, port pairing, and port opening now live in `WindowsUsbMidiTransport`, moving more USB transport setup out of `WindowsDeviceManager`.
- Windows targeted script packet sends now refuse to send when the captured device-session id is no longer the active connected session, avoiding stale-script writes through the wrong active transport.
- Windows now tracks the live script target as one `ActiveDeviceTarget` descriptor instead of parallel USB/BLE session fields, so send guards and receive routing resolve against one explicit active transport/session identity.
- Windows has an `ActiveDeviceTargetTests` suite for active-target device-id normalization and transport matching; local execution still depends on a machine with `dotnet` installed.

Remaining isolation work:

- finish moving debug/monitor and transport helpers off the `NativeBufferRust` process-wide facade,
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
- Android USB/BLE buffering now depends on a `TransportDeviceSession` contract, giving the future USB/BLE/Wi-Fi split a shared session boundary instead of binding transport code directly to `DeviceBufferSession`.
- Android BLE transport constants, advertisement matching, and device-session identity helpers now live in `AndroidBleTransport`, starting the same USB/BLE/Wi-Fi file split direction as macOS without changing connection behavior.
- Android USB MIDI descriptor matching, board inference, display names, and session identity helpers now live in `AndroidUsbMidiTransport`, so the current Android service has separate USB and BLE transport helper files.
- Android now has an `AndroidWiFiTransport` boundary with Wi-Fi session/display identity helpers for the future Wi-Fi runtime.
- Android has a local `DeviceBufferSessionTest` covering RX/counter and sampler-stream state isolation across separate transport sessions.
- Android USB MIDI and BLE receive callbacks now resolve the buffer session from the source device id before feeding SysEx data, removing one active-session contamination path in the live service.
- Android `ScriptDeviceConnection` now captures the active device-session id when a script starts and routes script buffer reads/writes, transmit-buffer calls, raw writes, and command waits through that captured session.
- Android USB MIDI send mechanics now live in `AndroidUsbMidiTransport`, and BLE characteristic write mechanics now live in `AndroidBleTransport`, reducing transport protocol code inside `USBService`.
- Android BLE scan filters/settings and `connectGatt` setup now live in `AndroidBleTransport`, moving more live BLE connection setup out of `USBService`.
- Android BLE MTU/service discovery, command characteristic lookup, and notification enablement now live in `AndroidBleTransport`, further reducing BLE protocol ownership inside `USBService`.
- Android USB MIDI device-info matching now lives in `AndroidUsbMidiTransport`, moving another USB connection-selection detail out of `USBService`.
- Android USB MIDI input/output port opening now lives in `AndroidUsbMidiTransport`, moving another USB setup detail out of `USBService`.
- Android USB MIDI live handles now sit behind an `AndroidUsbMidiTransport.Connection` object that owns the opened device, ports, session id, display name, send helper, board inference, and close behavior.
- Android targeted writes, command waits, and buffer transmit now refuse to send when the captured device-session id is no longer the active connected session, avoiding stale-script writes through the wrong active transport.
- Android now tracks the live script target as one `ActiveDeviceTarget` descriptor, keeping the active transport and active session id synchronized before the future per-device transport runtime split.
- Android has an `ActiveDeviceTargetTest` suite covering active-target device-id normalization and transport matching.

Remaining isolation work:

- keep remaining capture ownership scoped to the target session.
- split USB, BLE, and future Wi-Fi connection code into transport-specific services that implement the same session contract.

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
- iOS USB MIDI/BLE buffering now depends on a `TransportDeviceSession` protocol, giving the future USB/BLE/Wi-Fi split a shared session boundary instead of binding transport code directly to `DeviceBufferSession`.
- iOS BLE transport constants, advertisement matching, display names, and device-session identity helpers now live in `BLETransport`, starting the same USB/BLE/Wi-Fi file split direction as macOS without changing connection behavior.
- iOS USB MIDI endpoint pairing, target selection, display names, and session identity helpers now live in `USBMidiTransport`, so the current iOS manager has separate USB MIDI and BLE transport helper files.
- iOS now has a `WiFiTransport` boundary with Wi-Fi session/display identity helpers for the future Wi-Fi runtime.
- iOS has a local `DeviceBufferSessionTests` suite covering RX/counter and sampler-stream state isolation across separate transport sessions.
- iOS CoreMIDI and BLE receive callbacks now feed MIDI/SysEx bytes into the source transport session instead of always using the mutable active session.
- iOS targeted script devices now route `transmitBuffer()` through the captured device-session id instead of the mutable active session.
- iOS CoreMIDI SysEx send mechanics now live in `USBMidiTransport`, and BLE chunked characteristic writes now live in `BLETransport`, reducing transport protocol code inside `USBManager`.
- iOS BLE service discovery, characteristic lookup, and notify enablement now live in `BLETransport`, further reducing BLE protocol ownership inside `USBManager`.
- iOS CoreMIDI source connection/disconnection now lives in `USBMidiTransport`, moving another USB MIDI setup detail out of `USBManager`.
- iOS USB MIDI endpoint handles now sit behind a `USBMidiTransport.Connection` value that owns the endpoint pair, session key, display name, connect/disconnect behavior, and send helper.
- iOS targeted script packet sends, command waits, and buffer transmit now refuse to send when the captured device-session id is no longer the active connected session, avoiding stale-script writes through the wrong active transport.
- iOS now tracks the live script target as one `ActiveDeviceTarget` descriptor, so CoreMIDI receive routing and targeted script APIs share the same active transport/session identity.
- iOS has an `ActiveDeviceTargetTests` suite covering active-target device-id normalization and transport matching.

Remaining isolation work:

- split `USBManager`'s single `NativeBufferRust` state into target-scoped sessions,
- route remaining buffer APIs through the selected target session.
- split `USBManager` into USB MIDI, BLE, and future Wi-Fi transport files that implement the same session contract.

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
- [x] Windows binds local script runs to the active transport session id captured at run start.
- [x] Windows refuses targeted script sends when the captured transport session is no longer the active connected session.
- [x] Windows keeps active transport and active script session identity synchronized through one active target descriptor.
- [x] Windows has focused active-target normalization/matching tests in the local test project.
- [x] Windows has a shared transport device-session contract used by the current USB MIDI/BLE manager.
- [x] Android has an active transport buffer session object used by script sampler reads.
- [x] Android selects keyed USB/BLE buffer sessions instead of a single process-wide script buffer.
- [x] Android scopes sampler stream state to the active transport buffer session.
- [x] Android scopes command response wait state to the active transport buffer session.
- [x] Android scopes SysEx parser state to the active transport buffer session.
- [x] Android binds local script runs to the active device service captured at run start.
- [x] Android refuses targeted script sends when the captured transport session is no longer the active connected session.
- [x] Android keeps active transport and active script session identity synchronized through one active target descriptor.
- [x] Android has focused active-target normalization/matching tests.
- [x] Android has a shared transport device-session contract used by the current USB/BLE service.
- [x] Android USB MIDI live handles are grouped behind a transport-owned connection object.
- [x] iOS has an active transport buffer session object used by script sampler reads.
- [x] iOS selects keyed USB/BLE buffer sessions instead of a single process-wide script buffer.
- [x] iOS scopes sampler stream state to the active transport buffer session.
- [x] iOS scopes command response wait state to the active transport buffer session.
- [x] iOS scopes SysEx parser state to the active transport buffer session.
- [x] iOS binds local script runs to the active transport session key captured at run start.
- [x] iOS refuses targeted script sends when the captured transport session is no longer the active connected session.
- [x] iOS keeps active transport and active script session identity synchronized through one active target descriptor.
- [x] iOS has focused active-target normalization/matching tests.
- [x] iOS has a shared transport device-session protocol used by the current USB MIDI/BLE manager.
- [x] iOS USB MIDI live endpoint handles are grouped behind a transport-owned connection value.
- [ ] Windows has per-device host buffer/session state.
- [ ] Android has per-device host buffer/session state.
- [ ] iOS has per-device host buffer/session state.
- [ ] Windows USB/BLE/Wi-Fi transport code is split behind a shared session contract.
- [ ] Android USB/BLE/Wi-Fi transport code is split behind a shared session contract.
- [ ] iOS USB/BLE/Wi-Fi transport code is split behind a shared session contract.
- [ ] Windows can safely run two hardware scripts against two devices without shared buffer contamination.
- [ ] Android can safely run two hardware scripts against two devices without shared buffer contamination.
- [ ] iOS can safely run two hardware scripts against two devices without shared buffer contamination.
