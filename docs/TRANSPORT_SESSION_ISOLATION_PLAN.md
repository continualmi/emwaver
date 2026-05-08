# Transport Session Isolation Plan

This plan defines the work needed to run multiple `.emw` scripts fully in parallel on the same host, with each script bound to its own isolated device/session transport state.

The goal is complete isolation: one script's buffer, command response, sampler stream, logs, UI snapshots, and stop/reset lifecycle must not contaminate another script, whether the scripts run on different boards or on future board classes that can safely support multiple logical sessions.

## Product Goal

Support parallel script execution for local hardware benches.

Target examples:

```text
Script A -> ESP32-S3 BLE board A -> CC1101 module
Script B -> ESP32-S3 BLE board B -> RFM69HW module
```

```text
Script A -> USB MIDI STM32 board
Script B -> ESP32-S3 BLE board
```

Each script must behave as if it owns a private device connection:

- private capture buffer,
- private transmit buffer,
- private command response path,
- private streaming state,
- private UI/log/plot state,
- independent stop/reset/disconnect behavior.

This remains local-first. No account, cloud relay, device registration, hosted ownership, or subscription check is required for local parallel use.

## Current Problem

The app has started moving toward script sessions, but transport state is still shared in important places.

Current macOS shape:

- `MacScriptSessionManager` can create one `ScriptPreviewManager` per local script run.
- `RemoteControlHostService` can create one remote script manager per `script.run` request.
- Those managers can target a `deviceId` through a targeted `ScriptDevice` wrapper.

The weak point is that `MacUSBManager` still owns shared low-level state:

- one capture buffer,
- one RX packet list,
- one SysEx accumulator,
- one sampler-streaming flag,
- one response semaphore,
- one response payload,
- one response predicate,
- one command lock,
- one active USB MIDI endpoint pair,
- one default BLE peripheral, even though multiple connected BLE peripherals can be tracked.

That means `deviceId` routing can choose where writes go, but incoming data and buffer/response state are not fully separated per script/device. Two active scripts can race or contaminate one another, especially during sampler, retransmit, and command/response flows.

## Target Architecture

Split host transport into explicit device sessions.

```text
Scripts UI / Gateway / CLI
        |
        v
ScriptSessionRegistry
        |
        v
ScriptSession(sessionId, deviceId)
        |
        v
ScriptBoundDevice
        |
        v
DeviceSession(deviceId)
   | owns buffers, response waiters, stream state
   |
   +-- UsbMidiDeviceSession
   +-- BleDeviceSession
   +-- WifiDeviceSession later
```

Key rule:

- `ScriptSession` owns script/runtime/UI state.
- `DeviceSession` owns transport/buffer/command state.
- A script session binds to exactly one device session for the first implementation.
- A device session can have at most one active script owner initially, unless a future board/runtime explicitly supports safe multiplexing.

## Core Types

Recommended shared concepts:

```text
LocalDeviceDescriptor
  id
  displayName
  transport
  boardType
  moduleLabel
  connectionState
  activeScriptSessionId?
```

```text
DeviceSession
  deviceId
  descriptor
  connectionState
  sendPacket(data)
  sendCommand(data, timeout, predicate)
  getBuffer()
  clearBuffer()
  loadBuffer(data)
  transmitBuffer()
  stop()
  reset()
```

```text
ScriptSession
  sessionId
  scriptId
  scriptName
  deviceId
  runtimeManager
  latestSnapshot
  plotBuffers
  logs
  state
```

## Device Session Ownership

Each device session must own:

- transport handle:
  - USB MIDI source/destination, or
  - BLE peripheral/command characteristic/notify characteristic, or
  - future Wi-Fi socket/session;
- RX parser:
  - SysEx accumulator or transport-specific frame decoder;
- command queue:
  - serial command execution for that device only;
- response waiter:
  - response semaphore/continuation,
  - response predicate,
  - response timeout state;
- buffers:
  - capture buffer,
  - loaded transmit buffer,
  - RX packet history if still needed;
- stream flags:
  - sampler active,
  - retransmit active,
  - flow-control status;
- diagnostics:
  - last error,
  - last seen time,
  - command counters,
  - dropped frame counters.

No global buffer or global response waiter should remain in the transport manager after this refactor.

## Routing Rules

### Script To Device

Every runtime command must include an implicit or explicit `sessionId`.

Resolution path:

```text
sessionId -> ScriptSession -> deviceId -> DeviceSession
```

The script runtime should not ask for "the active device" after the session starts. It should hold a `ScriptDevice` adapter bound to one `DeviceSession`.

### Device To Script

Incoming transport data must be decoded by the matching `DeviceSession`.

Routing source:

- USB MIDI: endpoint/source identifies the device session.
- BLE: `CBPeripheral.identifier` identifies the device session.
- Wi-Fi later: socket/session identifies the device session.

The decoded command/stream lanes update only that device session's buffer and response waiter. UI snapshots and plots update only the bound script session.

### Device Busy Policy

First version policy:

- one active script per physical device session,
- many active scripts across different device sessions.

If a second script targets a busy device:

- return a clear busy error, or
- offer an explicit "stop existing session and run here" action.

Avoid silently sharing one device session between two scripts until the firmware/protocol has a real multiplexing contract.

## macOS Implementation Plan

### Phase 1: Extract Session Objects

Create session classes from `MacUSBManager` internals:

- `MacUsbMidiDeviceSession`
- `MacBleDeviceSession`
- future `MacWifiDeviceSession`

Move per-device state out of `MacUSBManager`:

- `captureBuffer`,
- `rxPackets`,
- `sysexAccumulator`,
- `isSamplerStreamingActive`,
- `waitingForResponse`,
- `responseSemaphore`,
- `responseData`,
- `responsePredicate`,
- command lock.

`MacUSBManager` should become a device registry/coordinator, not the owner of all transport state.

### Phase 2: Session Registry

Add a macOS device registry that owns:

- discovered candidates,
- connected sessions by `deviceId`,
- selected default device for legacy UI,
- local labels/module labels,
- device busy/session ownership state.

Required API shape:

```swift
func session(for deviceID: String) -> DeviceSession?
func connect(deviceID: String) async throws -> DeviceSession
func disconnect(deviceID: String)
func markBusy(deviceID: String, sessionID: String)
func release(deviceID: String, sessionID: String)
```

Keep a compatibility `activeDevice` adapter for older single-device flows while new script sessions bind directly to a session.

### Phase 3: Script-Bound Device Adapter

Replace targeted wrappers that call back into global `MacUSBManager` buffer methods with wrappers that hold a specific `DeviceSession`.

Current pattern to remove:

```text
ScriptDevice -> MacUSBManager.getBuffer()
ScriptDevice -> MacUSBManager.sendCommand(..., deviceID)
```

Target pattern:

```text
ScriptDevice -> DeviceSession.getBuffer()
ScriptDevice -> DeviceSession.sendCommand(...)
```

The `deviceId` should be resolved before script start, not on every command.

### Phase 4: Incoming Data Demultiplexing

Route incoming data to the correct session before parsing response/buffer state.

For CoreMIDI:

- associate `MIDIEndpointRef` source with `MacUsbMidiDeviceSession`,
- pass incoming packet bytes to that session's parser,
- do not use a global SysEx accumulator.

For CoreBluetooth:

- use callback `peripheral.identifier`,
- find `MacBleDeviceSession`,
- pass notify value to that session's parser,
- do not let one BLE notification update another device's buffer.

### Phase 5: Script Session Ownership

Update `MacScriptSessionManager` and `RemoteControlHostService`:

- resolve target `deviceId`,
- ensure device session is connected,
- check busy policy,
- bind script manager to a `ScriptBoundDevice(session:)`,
- record `sessionId -> deviceId`,
- mark device busy,
- release device on stop/error/disconnect.

Every event emitted to gateway should include:

- `scriptInstanceId`,
- `sessionId` if different from script instance id,
- `deviceId`,
- transport,
- script state.

### Phase 6: Stop, Reset, And Disconnect

Stop must be scoped:

- stopping script A clears/release only script A's runtime and device ownership,
- stopping script A does not clear script B's buffer,
- disconnecting device A stops only sessions bound to device A,
- app shutdown stops all sessions cleanly.

Add per-device safe reset:

- stop sampler,
- stop transmit,
- set PWM/GPIO safe states where appropriate,
- clear response waiters for that device.

## Daemon Implementation Plan

The Rust daemon is also currently single-device-oriented for direct hardware mode.

Target daemon model:

```text
DeviceRegistry
  -> DeviceSession trait objects
  -> ScriptSessionRegistry
```

Rust-side work:

- introduce a `DeviceSession` trait separate from the existing single `CommandBridge`,
- move buffer state into the session object,
- create one `CommandBridge` adapter per script session,
- allow gateway `script.run` to include `deviceId`,
- return busy errors for already-owned devices,
- support multiple device sessions when USB/BLE/Wi-Fi adapters can enumerate them concurrently.

The first daemon slice can keep one hardware session per daemon process, but the interface should stop assuming that one process equals one global buffer forever.

## Gateway Protocol Changes

Gateway messages should carry session/device identity consistently.

`script.run` request:

```json
{
  "type": "script.run",
  "script": "...",
  "name": "cc1101.emw",
  "deviceId": "ble:...",
  "requestId": "..."
}
```

`script.started` response:

```json
{
  "type": "script.started",
  "scriptInstanceId": "...",
  "sessionId": "...",
  "deviceId": "ble:...",
  "transport": "BLE"
}
```

Every session-scoped event should include identity:

- `script.stopped`,
- `script.error`,
- `ui.snapshot`,
- `ui.event`,
- `plot.data`,
- `plot.viewport`,
- future logs/status messages.

Device status should include busy state:

```json
{
  "id": "ble:...",
  "name": "ESP32-S3 / CC1101",
  "transport": "BLE",
  "connected": true,
  "activeScriptSessionId": "...",
  "busy": true
}
```

## Buffer Contract

Every script-visible buffer API must be session-local.

Required behavior:

- `Device.getBuffer()` returns only data captured by that script's bound device session.
- `Device.clearBuffer()` clears only that session/device buffer.
- `Device.loadBuffer()` loads transmit data only for that session/device.
- `Device.transmitBuffer()` transmits only that session/device buffer.
- Sampler stream lanes from device A never appear in device B's buffer.
- Command response from device A never wakes a waiter for device B.

For first release, because one physical device has one active script owner, the buffer can live on the `DeviceSession`. If future firmware supports true multiplexed scripts on one physical board, buffer state should move one level deeper to `LogicalDeviceSession`.

## Same Device Parallelism

Running multiple scripts on the same physical board is not safe by default.

First policy:

- allow full parallelism across different physical devices,
- reject two active scripts on the same physical device,
- document the error clearly.

Future same-device parallelism would require firmware/protocol support:

- logical channel id in every command/response/stream frame,
- per-channel sampler/transmit ownership,
- per-channel peripheral reservation,
- conflict handling for GPIO/SPI/I2C/PWM/RF modules.

Do not fake same-device parallelism by sharing one physical command channel between unrelated scripts.

## Testing Matrix

Minimum tests:

| Case | Expected result |
| --- | --- |
| Two BLE devices, two scripts | Both run concurrently with separate buffers |
| BLE + USB devices, two scripts | Both run concurrently with separate buffers |
| Script A clears buffer | Script B buffer is unchanged |
| Script A sampler active | Script B command responses still work |
| Device A disconnects | Script B continues running |
| Script A stops | Script B continues running |
| Two scripts target same device | Second run gets busy error |
| Gateway UI events include session id | Event reaches only the intended script |
| Plot data request includes session id | Plot buffer comes from intended script |
| Remote `script.stop` by id | Stops only matching script session |

Hardware validation:

- CC1101 script on ESP32-S3 board A while RFM69HW script runs on board B.
- PWM/servo script on one board while ADC/GPIO loopback captures on another.
- Sampler/retransmit flow on one board while ordinary command/response runs on another.

## Acceptance Criteria

The isolation work is complete when:

- no script-visible buffer state is stored globally in a multi-device host manager,
- every active script has a bound device session,
- every connected device session has independent RX/TX/response state,
- gateway messages identify the script and device for all session-scoped events,
- two real devices can run scripts concurrently without buffer contamination,
- disconnecting/stopping/resetting one session does not affect unrelated sessions,
- same-device concurrent script attempts are rejected until explicit multiplexing exists.

## Implementation Order

1. Extract a `DeviceSession` protocol/interface.
2. Move macOS BLE per-peripheral parser/buffer/response state into `MacBleDeviceSession`.
3. Move macOS USB MIDI parser/buffer/response state into `MacUsbMidiDeviceSession`.
4. Convert `MacUSBManager` into a registry/coordinator with an active-device compatibility adapter.
5. Bind local script sessions to `DeviceSession`, not `MacUSBManager`.
6. Bind gateway remote script sessions to `DeviceSession`, not `MacUSBManager`.
7. Add busy-state tracking and same-device rejection.
8. Add device/session ids to all gateway script events.
9. Add regression tests with simulator/fake device sessions.
10. Validate on two ESP32-S3 BLE boards.
11. Validate mixed ESP32-S3 BLE plus STM32 USB MIDI.
12. Update app/daemon/gateway docs with final behavior.

## Non-Negotiables

- No global capture buffer for parallel-capable hosts.
- No global command response waiter for parallel-capable hosts.
- No implicit active-device lookup inside an already-running script.
- No silent sharing of one physical device between two scripts.
- No cloud/account dependency for local parallel hardware use.
- Preserve old single-device UX through compatibility adapters while the internals move to sessions.
