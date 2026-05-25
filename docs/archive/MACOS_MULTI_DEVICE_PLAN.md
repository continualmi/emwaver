# macOS Multi-Device Plan

This plan captures the first implementation path for using the macOS app as a local multi-device host for agent-driven hardware testing.

## Goal

Support multiple connected EMWaver boards in the macOS app so a local agent can choose which board to use for a script or test. The near-term bench target is:

- one ESP32-S3 BLE board wired to a CC1101 module,
- one ESP32-S3 BLE board wired to an RFM69HW module,
- later: mixed benches such as one ESP32-S3 BLE board plus one USB MIDI STM32 board.

The app should remain local-first: no account, cloud activation, device ownership check, hosted relay, or subscription gate for local device control.

## Why this matters

The core product loop is automation:

1. connect a box of real hardware,
2. have the CLI/gateway/app expose it locally,
3. let a coding agent write and edit `.emw` scripts,
4. run scripts against selected devices,
5. inspect UI snapshots/logs/device status,
6. send UI events,
7. stop/reset hardware,
8. repeat until every hardware loop is validated.

This is the foundation for validating EMWaver capabilities directly from a terminal agent and later from the in-app Agent.

## Current shape

`MacUSBManager` currently acts like a single active `ScriptDevice`:

- USB MIDI and ESP32 BLE both feed one manager.
- `isConnected`, `connectedPortName`, `connectedTransportKind`, and `connectedBoardType` describe one selected connection.
- auto-connect prefers USB MIDI first, then scans BLE when no wired device is connected.
- the script runtime receives one `ScriptDevice` and sends packets to that active transport.
- the macOS app owns its own runtime/device session; Gateway terminal/browser workflows are separate.
- only one script preview/runtime is currently active at a time.

That is enough for one board, but not enough for a bench with CC1101 and RFM69HW connected at the same time.

## Target architecture

Introduce a multi-device host layer above the existing transport code.

```text
Scripts UI / local Agent commands
        |
        v
Selected Device Context
        |
        v
MacDeviceRegistry / MacDeviceManager
   |                 |
   v                 v
BLE session A     BLE session B     USB MIDI session N
ESP32+CC1101      ESP32+RFM69HW     STM32/other
```

Key idea: preserve the existing single-device transport behavior as a per-device session, but manage multiple sessions in a registry. The first compatibility layer can still expose an active device for old single-script flows, but the target architecture should allow one script runtime per connected device so two scripts can run at the same time on different boards.

## Device model

Add a stable app-level device descriptor, for example:

```swift
struct LocalDeviceDescriptor: Identifiable, Equatable {
    let id: String              // stable app id, e.g. ble:<uuid> or midi:<endpoint-id>
    var displayName: String
    var transport: TransportKind // ble, usbMidi
    var boardType: String?       // esp32s3, stm32f042, unknown
    var moduleLabel: String?     // user label: CC1101, RFM69HW, etc.
    var connectionState: ConnectionState
    var lastErrorText: String?
}
```

Stable id guidance:

- BLE: use CoreBluetooth peripheral identifier while available, with a user-editable label for clarity.
- USB MIDI: use endpoint unique id/name combination where possible, with user-editable label.
- Do not require hardware UID reads for activation or ownership.

## Implementation phases

### Phase 1 — Discovery and selection UI

Goal: see multiple candidates and pick the active board.

Tasks:

- Replace the single `availablePorts: [String]` surface with a unified list of USB MIDI and BLE candidates.
- Keep scanning BLE even when one BLE device is connected, so a second ESP32-S3 can be discovered.
- Add a macOS device picker/list showing:
  - display name,
  - transport,
  - board type if known,
  - connection state,
  - user label/module label.
- Add actions:
  - connect,
  - disconnect,
  - set active,
  - rename/label device.
- Keep auto-connect conservative: connect first suitable device for old single-device workflows, but do not hide additional candidates.

Acceptance:

- With two ESP32-S3 BLE boards powered, the app can show both.
- User can connect/select either board as the active script target.
- Existing one-device scripts still work.

### Phase 2 — Per-device sessions

Goal: allow more than one board to stay connected at the same time.

Tasks:

- Split `MacUSBManager` internals into reusable per-transport session objects, for example:
  - `MacUsbMidiDeviceSession`,
  - `MacBleDeviceSession`.
- Move per-connection state into each session:
  - peripheral/endpoint refs,
  - command characteristic,
  - notify characteristic,
  - sysex accumulator,
  - capture buffer,
  - command response semaphore/predicate,
  - sampler streaming state,
  - error/status.
- Add a registry/manager that owns multiple sessions and exposes one active `ScriptDevice` adapter to the existing script runtime.
- Preserve the existing single-device `ScriptDevice` API by routing calls to the active session.

Acceptance:

- Two BLE boards can remain connected simultaneously.
- Switching active device changes where `sendPacket`/`sendCommand` go.
- Disconnecting one device does not tear down the other.

### Phase 3 — Per-device script runtimes

Goal: allow multiple scripts to run at the same time when they target different devices.

Tasks:

- Introduce a `ScriptSession` concept keyed by `sessionId` and `deviceId`.
- Each connected device can own at most one active script session initially.
- Each session owns its own script runtime state, UI tree, plot buffers, latest snapshot, logs/errors, and stop/reset lifecycle.
- Route `sendPacket`/`sendCommand` from that runtime only to its bound device session.
- Keep the current active-device/current-script UI as a compatibility view, but allow a device/session switcher to inspect another running script.
- Add per-device safe stop/reset so stopping the RFM69HW script does not stop the CC1101 script.

Acceptance:

- A CC1101 script can keep running on ESP32-S3 device A while an RFM69HW script runs on ESP32-S3 device B.
- UI snapshots and logs are attributed to the correct script session and device.
- Stopping or disconnecting one device/session does not tear down the other.

### Phase 4 — Gateway and CLI selection

Goal: let terminal agents choose the target device/session through the gateway.

Tasks:

- Extend Gateway/native app status with a real device list instead of only a single local app placeholder.
- Add device fields to status messages:
  - `id`, `name`, `transport`, `boardType`, `moduleLabel`, `connected`, `active`.
- Add control messages for active-device/session selection, e.g. `device.select` and `script.session.select`.
- Allow `script.run` to include `deviceId` for one-shot target selection and return a `sessionId`.
- Include `deviceId` and `sessionId` on `script.started`, `script.stopped`, `script.error`, `ui.snapshot`, plot messages, and future log/status messages.
- Add CLI helpers later:
  - `emw devices --gateway`,
  - `emw device select <id>`,
  - `emw run script.emw --device <id>`.

Acceptance:

- A terminal agent can list app-owned devices through localhost gateway.
- A terminal agent can select CC1101 board vs RFM69HW board before running a script.
- A terminal agent can run two scripts concurrently by targeting different `deviceId`s.
- Existing `emw run script.emw` still targets the current active device/session.

### Phase 5 — Module-aware labels and test bench presets

Goal: make the physical bench understandable to humans and agents.

Tasks:

- Add user-editable module labels such as `CC1101`, `RFM69HW`, `RFID`, `PWM Servo`, `Loopback ADC/GPIO`.
- Persist labels locally by stable device id.
- Show labels in device picker, settings, and gateway status.
- Add a lightweight bench manifest concept later, for example local JSON:

```json
{
  "devices": [
    { "id": "ble:...", "label": "esp32-cc1101", "module": "CC1101" },
    { "id": "ble:...", "label": "esp32-rfm69hw", "module": "RFM69HW" }
  ]
}
```

Acceptance:

- Agent can identify the intended target by label, not by unstable Bluetooth names alone.
- The app remembers labels across launches.

### Phase 6 — Coordinated multi-device tests

Goal: validate loops where one device stimulates and another observes.

Examples:

- CC1101 board transmits while RFM69HW board listens, where compatible.
- One board toggles GPIO/PWM while another samples a loopback signal.
- One board generates SPI/I2C/UART activity while another captures or verifies external effects.

Tasks:

- Keep each `.emw` script single-device initially, but allow multiple single-device scripts to run concurrently on different devices.
- Prefer CLI/gateway orchestration before adding a multi-device `.emw` language API:
  - run TX/control script on device A,
  - run RX/capture/check script on device B,
  - collect snapshots/logs from both sessions,
  - send UI events to either session by `sessionId`,
  - stop/reset either session independently.
- Later consider a multi-device script API only after concurrent single-device sessions are reliable.

Acceptance:

- One agent session can run a repeatable two-board validation sequence without manually reconnecting devices.

## Non-goals for first pass

- No cloud-hosted device registry.
- No account-backed bench sync.
- No hardware UID activation or ownership check.
- No paid gate around local multi-device use.
- No requirement to solve distributed remote control before local multi-device works.
- No immediate need for a multi-device `.emw` language extension; concurrent single-device scripts plus gateway/CLI orchestration can come first.

## Risks and design notes

- CoreBluetooth scanning/connection behavior may need careful handling to keep scanning while connected to one peripheral.
- The current `ScriptDevice` protocol is single-target. Preserve compatibility by exposing an active-device adapter first, then move toward one `ScriptDevice` binding per script session.
- Shared Apple code may eventually need a generic multi-device abstraction, but the first implementation can stay macOS-specific until proven.
- UI snapshot attribution becomes mandatory once multiple scripts can run. Include `deviceId` and `sessionId` in gateway status, run metadata, snapshots, plots, logs, errors, and stop events.
- Hardware reset/safe-state commands should be available per device, especially for PWM/GPIO/RF tests.

## Suggested first PR

1. Add the device descriptor model and local label storage.
2. Refactor discovery state so the UI can show multiple USB/BLE candidates.
3. Add a basic device picker with active-device selection.
4. Keep initial script execution routed through the selected active device for compatibility.
5. Follow with per-device script sessions so CC1101 and RFM69HW scripts can run concurrently.
6. Document validation results with two ESP32-S3 BLE boards: `CC1101` and `RFM69HW`.
