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

- Windows shows the current script target in the top device button before Run, using the connected port display name when available.
- scripts list shows the active run as a session row,
- Windows now represents running scripts through an explicit `ScriptSessionRegistry` and a dedicated "Running" list section instead of inserting one transient item into Examples; the current runtime still owns one active engine, and replacement runs stop the previously selected runtime while keeping that prior session row visible as `stopped`.
- Windows script sessions now own a runtime stop callback, so row-level stop/clear shuts down the session-owned runtime path instead of depending on a separate page-global pre-stop.
- Windows script session rows now retain the captured transport device-session id separately from the display label, so future row-level routing does not have to recover identity from UI text.
- the session row shows the active device label when available,
- the Windows session row now reads the connected port's `DisplayName`, so USB MIDI rows show the actual target label instead of falling back to transport text.
- the session row has a stop button,
- stopped Windows session rows remain visible without an active stop button, so replacement-run history does not look like a still-controllable runtime.
- running a different script no longer shows the old "Stop and Run" switch prompt.
- the Windows session-row and toolbar stop controls now stop the active script directly, matching the simplified macOS row-control behavior.
- the Windows session-row and toolbar stop controls now use the existing error/destructive brush instead of the normal command tint.
- active transport buffer state is now represented by a `DeviceBufferSession` instead of direct script-runtime reads from the process-wide buffer facade.
- Windows USB and BLE connections now select keyed buffer sessions, matching the macOS target-session direction even though only one transport connection is active at a time today.
- Windows script sampler packet APIs now use the transport lane size exposed by `NativeBufferRust.PacketSizeBytes` instead of assuming 64-byte packets.
- Windows command response wait state now lives on the active `DeviceBufferSession` instead of singleton fields on `WindowsDeviceManager`.
- Windows SysEx parser accumulator and lane demux now live on the active `DeviceBufferSession`, including BLE notification chunk reassembly.
- Windows captures the active transport session id when a local script starts and routes script buffer/command APIs through that keyed session.
- Windows USB MIDI/BLE buffering now depends on an `ITransportDeviceSession` contract, giving the future USB/BLE/Wi-Fi split a shared session boundary instead of binding transport code directly to `DeviceBufferSession`.
- Windows active-session selection now makes buffer reset an explicit choice, preserving the future path where selecting an already-connected device session does not silently wipe its buffers.
- Windows buffer session lookup/selection now lives in `TransportDeviceSessionRegistry` instead of inline map ownership inside `WindowsDeviceManager`.
- Windows BLE transport constants, display names, board type, and device-session identity helpers now live in `WindowsBleTransport`, starting the same USB/BLE/Wi-Fi file split direction as macOS without changing connection behavior.
- Windows USB MIDI port pairing, target selection, board inference, and session identity helpers now live in `WindowsUsbMidiTransport`, so the current Windows manager has separate USB and BLE transport helper files.
- Windows now has a `WindowsWiFiTransport` boundary with Wi-Fi session/display identity helpers for the future Wi-Fi runtime.
- Windows has focused `WindowsWiFiTransportTests` coverage for Wi-Fi session/display identity; local execution still depends on a machine with `dotnet` installed.
- Windows Wi-Fi transport now has a transport-owned connection value that carries the normalized Wi-Fi session id, display label, and `ITransportDeviceSession` instance for future live Wi-Fi sockets.
- Windows has a local `DeviceBufferSessionTests` suite covering RX/counter and SysEx parser state isolation across separate transport sessions.
- Windows `DeviceBufferSessionTests` now also cover TX buffer isolation across separate transport sessions.
- Windows USB MIDI and BLE receive callbacks now feed SysEx data into the connected transport session instead of always using the mutable active session.
- Windows USB MIDI SysEx message sending now lives in `WindowsUsbMidiTransport`, and BLE chunked GATT writes now live in `WindowsBleTransport`, reducing transport protocol code inside `WindowsDeviceManager`.
- Windows BLE watcher creation, device opening, service/characteristic lookup, and notification descriptor setup now live in `WindowsBleTransport`, further reducing BLE protocol ownership inside `WindowsDeviceManager`.
- Windows BLE scan watcher state now sits behind a `WindowsBleTransport.ScanSession` object that owns the advertisement watcher subscription and shutdown behavior.
- Windows BLE composite shutdown now routes through `WindowsBleTransport.CloseHandles(...)`, so `WindowsDeviceManager` clears active app state while the BLE transport owns scan/connection disposal.
- Windows command TX logging now follows the command's target transport session instead of always appending to the mutable active buffer session.
- Windows USB MIDI device enumeration, port pairing, and port opening now live in `WindowsUsbMidiTransport`, moving more USB transport setup out of `WindowsDeviceManager`.
- Windows USB MIDI live handles now sit behind a `WindowsUsbMidiTransport.Connection` object that owns the opened port pair, session id, display name, send helper, and close behavior.
- Windows USB MIDI receive subscription now belongs to `WindowsUsbMidiTransport.Connection`, matching the BLE notification-subscription ownership pattern.
- Windows BLE live handles now sit behind a `WindowsBleTransport.Connection` object that owns the BLE device, command/notify characteristics, session id, display name, notification subscription, send helper, and dispose behavior.
- Windows STM32 DFU presence probing now lives on the `Dfu` service instead of duplicating USB enumeration inside higher-level managers.
- Windows targeted script packet sends now refuse to send when the captured device-session id is no longer the active connected session, avoiding stale-script writes through the wrong active transport.
- Windows now tracks the live script target as one `ActiveDeviceTarget` descriptor instead of parallel USB/BLE session fields, so send guards and receive routing resolve against one explicit active transport/session identity.
- Windows has an `ActiveDeviceTargetTests` suite for active-target device-id normalization and transport matching; local execution still depends on a machine with `dotnet` installed.
- Windows local script I/O now goes through a `TargetedScriptDeviceConnection` adapter, matching the target-scoped bridge direction on Apple/Android instead of leaving packet, sampler, and clear callbacks as loose page-level lambdas.
- Windows USB MIDI and BLE connection values now receive the same registry-owned `ITransportDeviceSession` selected for the active target, so the shared connection contract owns the live script-facing session instead of a parallel session object.
- Windows now keeps the active connection behind the shared `ITransportDeviceConnection` contract for script target identity, reducing manager dependence on concrete USB/BLE connection fields.
- Windows `TargetedScriptDeviceConnection` has focused coverage for blank captured device ids routing as `active`, matching the other host adapters.
- Windows has a focused `TargetedScriptDeviceConnectionTests` case covering captured-device routing for packet sends, sampler reads, and sampler clears; local execution still depends on a machine with `dotnet` installed.

Remaining isolation work:

- finish moving debug/monitor and transport helpers off the `NativeBufferRust` process-wide facade,
- keep sampler stream state and capture buffers scoped to that device session.
- continue reducing `WindowsDeviceManager` toward USB MIDI, BLE, and future Wi-Fi transport units with a shared device/session contract.

## Android direction

Current first step:

- script rows show "Running on active device" for the current run,
- Android now represents running scripts as explicit `AndroidScriptSession` entries in a "Running" list section instead of only decorating the source script row, matching the macOS/iOS session-row direction while the runtime still owns one active engine; replacement runs stop the previously selected runtime while keeping that prior session row visible as `Stopped`.
- Android script sessions now own a runtime stop callback, so row-level stop/clear shuts down the session-owned runtime path instead of depending on a separate pre-stop fragment global.
- Android script session rows now retain the captured device-session id from `ScriptDeviceConnection`, so future row-level routing does not have to recover identity from UI text.
- Android shows the current run target above the scripts list before a script starts, so the visible Run target no longer only appears after the session row is running.
- Android now captures the active USB/BLE connection label when a script starts and shows that label in the running script row when available.
- the running row has a stop button,
- stopped Android session rows remain visible without an active stop button, so replacement-run history does not look like a still-controllable runtime.
- the running row stop button now uses a destructive action color instead of the normal edit/action tint, matching the simplified row-control treatment on the other hosts.
- leaving preview can keep the run visible in the list rather than making the list look idle.
- `USBService` now routes script-facing capture buffers through a `DeviceBufferSession` instance instead of direct reads/writes to the process-wide `NativeBuffer` facade.
- Android USB and BLE connections now select keyed buffer sessions, matching the Windows/macOS direction even though only one transport session is active at a time today.
- Android script sampler packet APIs now use the active bridge packet size instead of assuming 64-byte packets.
- Android sampler stream lane policy state now lives on the active `DeviceBufferSession` instead of singleton fields on `USBService`.
- Android command response wait cursor/polling now lives on the active `DeviceBufferSession` instead of inline state in `USBService`.
- Android SysEx parser accumulator and lane demux now live on the active `DeviceBufferSession` instead of singleton fields on `USBService`.
- Android captures the active device service into `ScriptDeviceConnection` when a local script starts, so script I/O no longer re-resolves whichever service is active later.
- Android `ScriptDeviceConnection` normalizes the captured device-session id before script I/O routing, matching the Windows target adapter behavior and avoiding whitespace-sensitive or blank session keys.
- Android USB/BLE buffering now depends on a `TransportDeviceSession` contract, giving the future USB/BLE/Wi-Fi split a shared session boundary instead of binding transport code directly to `DeviceBufferSession`.
- Android active-session selection now makes buffer reset an explicit choice, preserving the future path where selecting an already-connected device session does not silently wipe its buffers.
- Android buffer session lookup/selection now lives in `TransportDeviceSessionRegistry` instead of inline map ownership inside `USBService`.
- Android BLE transport constants, advertisement matching, display names, board type, and device-session identity helpers now live in `AndroidBleTransport`, starting the same USB/BLE/Wi-Fi file split direction as macOS without changing connection behavior.
- Android USB MIDI descriptor matching, board inference, display names, and session identity helpers now live in `AndroidUsbMidiTransport`, so the current Android service has separate USB and BLE transport helper files.
- Android now has an `AndroidWiFiTransport` boundary with Wi-Fi session/display identity helpers for the future Wi-Fi runtime.
- Android has focused `AndroidWiFiTransportTest` coverage for Wi-Fi session/display identity.
- Android Wi-Fi transport now has a transport-owned connection value that carries the normalized Wi-Fi session id, display label, and `TransportDeviceSession` instance for future live Wi-Fi sockets.
- Android has a local `DeviceBufferSessionTest` covering RX/counter and sampler-stream state isolation across separate transport sessions.
- Android `DeviceBufferSessionTest` now also covers TX buffer isolation across separate transport sessions.
- Android USB MIDI and BLE receive callbacks now resolve the buffer session from the source device id before feeding SysEx data, removing one active-session contamination path in the live service.
- Android `ScriptDeviceConnection` now captures the active device-session id when a script starts and routes script buffer reads/writes, transmit-buffer calls, raw writes, and command waits through that captured session.
- Android `ScriptDeviceConnectionTest` now asserts the captured device-session id is exposed directly as well as used for script I/O routing.
- Android USB MIDI send mechanics now live in `AndroidUsbMidiTransport`, and BLE characteristic write mechanics now live in `AndroidBleTransport`, reducing transport protocol code inside `USBService`.
- Android BLE scan filters/settings and `connectGatt` setup now live in `AndroidBleTransport`, moving more live BLE connection setup out of `USBService`.
- Android BLE MTU/service discovery, command characteristic lookup, and notification enablement now live in `AndroidBleTransport`, further reducing BLE protocol ownership inside `USBService`.
- Android BLE live handles now sit behind an `AndroidBleTransport.Connection` object that owns the GATT handle, command characteristic, session id, display name, connected state, write helper, and close behavior.
- Android BLE pending connection state now sits behind an `AndroidBleTransport.PendingConnection` object that owns the pending GATT handle and display name before service discovery completes.
- Android BLE scan state now sits behind an `AndroidBleTransport.ScanSession` object that owns scanner start/stop state.
- Android BLE composite shutdown now routes through `AndroidBleTransport.closeHandles(...)`, so `USBService` clears active app state while the BLE transport owns handle shutdown.
- Android USB MIDI runtime device discovery now lives in `AndroidUsbMidiTransport`, keeping supported-device matching and selection together.
- Android USB MIDI device-info matching now lives in `AndroidUsbMidiTransport`, moving another USB connection-selection detail out of `USBService`.
- Android USB MIDI input/output port opening now lives in `AndroidUsbMidiTransport`, moving another USB setup detail out of `USBService`.
- Android USB MIDI live handles now sit behind an `AndroidUsbMidiTransport.Connection` object that owns the opened device, ports, session id, display name, send helper, board inference, and close behavior.
- Android USB MIDI receive attachment now belongs to `AndroidUsbMidiTransport.Connection`, matching the Windows USB MIDI receive-subscription ownership pattern.
- Android targeted writes, command waits, and buffer transmit now refuse to send when the captured device-session id is no longer the active connected session, avoiding stale-script writes through the wrong active transport.
- Android now tracks the live script target as one `ActiveDeviceTarget` descriptor, keeping the active transport and active session id synchronized before the future per-device transport runtime split.
- Android USB MIDI and BLE connection objects now receive the same registry-owned `TransportDeviceSession` selected for the active target, so the shared connection contract owns the live script-facing session instead of a parallel session object.
- Android now keeps the active connection behind the shared `TransportDeviceConnection` contract for script target identity and connection labeling, reducing service dependence on concrete USB/BLE connection fields.
- Android active target/connection ownership now lives in a small `TransportDeviceConnectionState` helper with focused JVM coverage, keeping this parity boundary testable outside Android service lifecycle.
- Android has an `ActiveDeviceTargetTest` suite covering active-target device-id normalization and transport matching.

Remaining isolation work:

- keep remaining capture ownership scoped to the target session.
- continue reducing USB, BLE, and future Wi-Fi connection code into transport-specific services that implement the same session contract.

## iOS direction

iOS already uses the shared SwiftUI scripts surface, so list-level session display now uses the same `ScriptsRootView.ScriptSessionStatus` hook as macOS. iOS now has keyed transport buffer sessions and can keep multiple visible local script sessions in the shared scripts list. Multi-device concurrency stays gated on live multi-connection support and target-scoped script runtime ownership.

Current first step:

- iOS shows the current run target in the scripts toolbar before a script starts, using the same selected device label captured into the session row after Run.
- the shared Apple `ScriptSessionStatus` now carries `deviceId`, so macOS and iOS visible session rows can retain target identity separately from display labels.
- iOS keeps local script sessions in a session registry and lets the shared scripts list select/stop individual visible sessions instead of replacing the active row on every Run.
- iOS script sessions now own their stop path explicitly, so row-level stop shuts down the session-owned preview manager instead of reaching through manager internals.
- iOS/shared Apple script rows now only show the destructive stop control when a retained session status is actually running, so stopped history rows do not look like live controls.
- iOS local script sessions now retain the captured transport device-session id alongside the visible status row data.
- iOS local script session creation now depends on the targeted-device protocol boundary rather than the concrete `USBManager`, and focused tests cover separate sessions retaining distinct captured transport ids.
- iOS local script session creation normalizes blank captured device ids as `active`, matching the Windows and Android target adapters.
- `USBManager` now routes script-facing capture buffer reads/writes through a `DeviceBufferSession` object instead of direct stateful access to the `NativeBufferRust` process-wide facade.
- iOS USB MIDI and BLE connections now select keyed buffer sessions, matching the Windows/Android/macOS direction even though only one transport session is active at a time today.
- the shared Apple script runtime now derives sampler packet slicing from `ScriptDevice.bufferPacketSizeBytes()` instead of assuming 64-byte packets.
- iOS sampler stream lane policy state now lives on the active `DeviceBufferSession` instead of singleton fields on `USBManager`.
- iOS command response wait cursor/polling now lives on the active `DeviceBufferSession` instead of inline state in `USBManager`.
- iOS SysEx parser accumulator and lane demux now live on the active `DeviceBufferSession` instead of singleton fields on `USBManager`.
- iOS captures the active transport session key when a local script starts and routes script buffer/command APIs through that keyed session.
- iOS USB MIDI/BLE buffering now depends on a `TransportDeviceSession` protocol, giving the future USB/BLE/Wi-Fi split a shared session boundary instead of binding transport code directly to `DeviceBufferSession`.
- iOS active-session selection now makes buffer reset an explicit choice, preserving the future path where selecting an already-connected device session does not silently wipe its buffers.
- iOS buffer session lookup/selection now lives in `TransportDeviceSessionRegistry` instead of inline map ownership inside `USBManager`.
- iOS BLE transport constants, advertisement matching, display names, and device-session identity helpers now live in `BLETransport`, starting the same USB/BLE/Wi-Fi file split direction as macOS without changing connection behavior.
- iOS USB MIDI endpoint pairing, target selection, display names, and session identity helpers now live in `USBMidiTransport`, so the current iOS manager has separate USB MIDI and BLE transport helper files.
- iOS now has a `WiFiTransport` boundary with Wi-Fi session/display identity helpers for the future Wi-Fi runtime.
- iOS has focused `WiFiTransportTests` coverage for Wi-Fi session/display identity.
- iOS Wi-Fi transport now has a transport-owned connection value that carries the normalized Wi-Fi session key, display label, and `TransportDeviceSession` instance for future live Wi-Fi sockets.
- iOS has a local `DeviceBufferSessionTests` suite covering RX/counter and sampler-stream state isolation across separate transport sessions.
- iOS `DeviceBufferSessionTests` now also cover TX buffer isolation across separate transport sessions.
- iOS CoreMIDI and BLE receive callbacks now feed MIDI/SysEx bytes into the source transport session instead of always using the mutable active session.
- iOS targeted script devices now route `transmitBuffer()` through the captured device-session id instead of the mutable active session.
- iOS CoreMIDI SysEx send mechanics now live in `USBMidiTransport`, and BLE chunked characteristic writes now live in `BLETransport`, reducing transport protocol code inside `USBManager`.
- iOS BLE service discovery, characteristic lookup, and notify enablement now live in `BLETransport`, further reducing BLE protocol ownership inside `USBManager`.
- iOS BLE live handles now sit behind `BLETransport.PendingConnection` and `BLETransport.Connection` values that own the peripheral, command/notify characteristics, session key, display name, write helper, and peripheral matching.
- iOS BLE scan state now sits behind a `BLETransport.ScanSession` object that owns scan start/stop state.
- iOS BLE scan, connect, and cancel operations now route through `BLETransport` helpers instead of direct CoreBluetooth calls in `USBManager`.
- iOS BLE composite shutdown now routes through `BLETransport.closeHandles(...)`, so `USBManager` clears app state while the BLE transport owns scan stop and pending/connected cancellation.
- iOS CoreMIDI source connection/disconnection now lives in `USBMidiTransport`, moving another USB MIDI setup detail out of `USBManager`.
- iOS USB MIDI endpoint handles now sit behind a `USBMidiTransport.Connection` value that owns the endpoint pair, session key, display name, connect/disconnect behavior, and send helper.
- iOS CoreMIDI packet-list byte extraction now lives in `USBMidiTransport`, leaving `USBManager` to route copied packet data to the active transport session.
- iOS targeted script packet sends, command waits, and buffer transmit now refuse to send when the captured device-session id is no longer the active connected session, avoiding stale-script writes through the wrong active transport.
- iOS now tracks the live script target as one `ActiveDeviceTarget` descriptor, so CoreMIDI receive routing and targeted script APIs share the same active transport/session identity.
- iOS USB MIDI and BLE connection values now receive the same registry-owned `TransportDeviceSession` selected for the active target, so the shared connection protocol owns the live script-facing session instead of a parallel session object.
- iOS now keeps the active connection behind the shared `TransportDeviceConnection` protocol for script target identity, reducing manager dependence on concrete USB MIDI/BLE connection values.
- iOS has an `ActiveDeviceTargetTests` suite covering active-target device-id normalization and transport matching.

Remaining isolation work:

- continue routing any remaining legacy buffer helper usage through target-scoped sessions,
- keep reducing `USBManager` into USB MIDI, BLE, and future Wi-Fi transport files that implement the same session contract.

## Acceptance checklist

- [x] macOS shows selected local device before Run.
- [x] macOS creates separate visible script sessions.
- [x] macOS targets script device APIs to the selected device id.
- [x] macOS has per-device host buffer/session state.
- [x] Windows shows the current target device before Run.
- [x] Windows shows active run status in the script list.
- [x] Windows represents active runs as explicit session rows in a dedicated Running section.
- [x] Windows has a row-level stop control for the active run.
- [x] Windows styles row-level and toolbar stop controls as destructive actions.
- [x] Android shows active run status in the script list.
- [x] Android represents active runs as explicit session rows in the script list.
- [x] Android shows the current target device before Run.
- [x] Android has a row-level stop control for the active run.
- [x] Android styles the row-level stop control as a destructive action instead of a normal edit/action button.
- [x] iOS shows active run status in the shared scripts list.
- [x] iOS shows the current target device before Run.
- [x] iOS can keep separate visible local script sessions in the shared scripts list.
- [x] iOS has a row-level stop control for the active run through the shared scripts row.
- [x] Windows has an active transport buffer session object used by script sampler reads.
- [x] Windows selects keyed USB/BLE buffer sessions instead of a single process-wide script buffer.
- [x] Windows scopes command response wait state to the active transport buffer session.
- [x] Windows scopes SysEx parser state to the active transport buffer session.
- [x] Windows scopes command TX logging to the command target transport session.
- [x] Windows has focused TX buffer isolation coverage for separate transport sessions.
- [x] Windows has focused session registry coverage for select-without-reset and select-with-reset behavior.
- [x] Windows binds local script runs to the active transport session id captured at run start.
- [x] Windows local script I/O uses a target-scoped adapter for packet sends, sampler reads, and sampler clears.
- [x] Windows refuses targeted script sends when the captured transport session is no longer the active connected session.
- [x] Windows keeps active transport and active script session identity synchronized through one active target descriptor.
- [x] Windows has focused active-target normalization/matching tests in the local test project.
- [x] Windows has a shared transport device-session contract used by the current USB MIDI/BLE manager.
- [x] Windows USB MIDI, BLE, and Wi-Fi connection values now conform to a shared `ITransportDeviceConnection` contract that exposes session identity, display name, and a transport-owned `ITransportDeviceSession`.
- [x] Windows USB MIDI and BLE connection values are wired to the registry-owned `ITransportDeviceSession` selected for the active script target.
- [x] Windows active script target identity is read through the shared `ITransportDeviceConnection` contract.
- [x] Windows USB MIDI live handles are grouped behind a transport-owned connection object.
- [x] Windows BLE live handles are grouped behind a transport-owned connection object.
- [x] Windows BLE scan watcher state is grouped behind a transport-owned scan session.
- [x] Android has an active transport buffer session object used by script sampler reads.
- [x] Android selects keyed USB/BLE buffer sessions instead of a single process-wide script buffer.
- [x] Android scopes sampler stream state to the active transport buffer session.
- [x] Android scopes command response wait state to the active transport buffer session.
- [x] Android scopes SysEx parser state to the active transport buffer session.
- [x] Android has focused TX buffer isolation coverage for separate transport sessions.
- [x] Android has focused session registry coverage for select-without-reset and select-with-reset behavior.
- [x] Android binds local script runs to the active device service captured at run start.
- [x] Android refuses targeted script sends when the captured transport session is no longer the active connected session.
- [x] Android keeps active transport and active script session identity synchronized through one active target descriptor.
- [x] Android has focused active-target normalization/matching tests.
- [x] Android has a shared transport device-session contract used by the current USB/BLE service.
- [x] Android USB MIDI, BLE, and Wi-Fi connection values now conform to a shared `TransportDeviceConnection` contract that exposes session identity, display name, and a transport-owned `TransportDeviceSession`.
- [x] Android USB MIDI and BLE connection values are wired to the registry-owned `TransportDeviceSession` selected for the active script target.
- [x] Android active script target identity and connection labels are read through the shared `TransportDeviceConnection` contract.
- [x] Android active connection state has focused JVM coverage for connection-owned script target identity and transport-scoped clearing.
- [x] Android USB MIDI live handles are grouped behind a transport-owned connection object.
- [x] Android BLE live handles are grouped behind a transport-owned connection object.
- [x] Android BLE pending connection state is grouped behind a transport-owned pending value.
- [x] Android BLE scan state is grouped behind a transport-owned scan session.
- [x] iOS has an active transport buffer session object used by script sampler reads.
- [x] iOS selects keyed USB/BLE buffer sessions instead of a single process-wide script buffer.
- [x] iOS scopes sampler stream state to the active transport buffer session.
- [x] iOS scopes command response wait state to the active transport buffer session.
- [x] iOS scopes SysEx parser state to the active transport buffer session.
- [x] iOS has focused TX buffer isolation coverage for separate transport sessions.
- [x] iOS has focused session registry coverage for select-without-reset and select-with-reset behavior.
- [x] iOS binds local script runs to the active transport session key captured at run start.
- [x] iOS refuses targeted script sends when the captured transport session is no longer the active connected session.
- [x] iOS keeps active transport and active script session identity synchronized through one active target descriptor.
- [x] iOS has focused active-target normalization/matching tests.
- [x] iOS has a shared transport device-session protocol used by the current USB MIDI/BLE manager.
- [x] iOS USB MIDI, BLE, and Wi-Fi connection values now conform to a shared `TransportDeviceConnection` protocol that exposes session identity, display name, and a transport-owned `TransportDeviceSession`.
- [x] iOS USB MIDI and BLE connection values are wired to the registry-owned `TransportDeviceSession` selected for the active script target.
- [x] iOS active script target identity is read through the shared `TransportDeviceConnection` protocol.
- [x] iOS USB MIDI live endpoint handles are grouped behind a transport-owned connection value.
- [x] iOS BLE live handles are grouped behind transport-owned pending/connected values.
- [x] iOS BLE scan state is grouped behind a transport-owned scan session.
- [x] iOS BLE scan/connect/cancel mechanics are grouped behind transport helpers.
- [x] Windows has keyed per-device host buffer/session state.
- [x] Android has keyed per-device host buffer/session state.
- [x] iOS has keyed per-device host buffer/session state.
- [ ] Windows USB/BLE/Wi-Fi transport code is split behind a shared session contract.
- [ ] Android USB/BLE/Wi-Fi transport code is split behind a shared session contract.
- [ ] iOS USB/BLE/Wi-Fi transport code is split behind a shared session contract.
- [ ] Windows can safely run two hardware scripts against two devices without shared buffer contamination.
- [ ] Android can safely run two hardware scripts against two devices without shared buffer contamination.
- [ ] iOS can safely run two hardware scripts against two devices without shared buffer contamination.
