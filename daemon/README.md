# EMWaver Headless Daemon (`/daemon`)

Rust-based local CLI/runtime workspace for EMWaver.

This is the terminal/runtime workspace that keeps USB ownership local to a machine for headless and developer flows. It does not provide an EMWaver-hosted relay, account session, or backend presence loop.

---

## 1) Purpose

The daemon is the **no-UI host runtime** for host-backed boards:
- owns USB connection to the EMWaver hardware,
- runs the script runtime and UI state machine headlessly,
- can send scripts to the localhost gateway or execute scripts directly in-process.

It is intended for always-on hosts (desktop, laptop, Raspberry Pi), not as a replacement for native GUI apps.

Firmware update UX remains in GUI apps; daemon focuses on host/runtime control.

---

## 2) Workspace layout

- `emwaver/` — CLI binary (`emwaver`) for daemon/device/status operations.
- `emwaver-device/` — reusable MIDI/SysEx device transport and EMWaver superframe protocol helpers.
- `emwaver-runtime/` — reusable Boa-backed `.emw` runtime and streamed UI tree model.
- `dev` — convenience build/run wrapper.
- `install/install.sh` — install helper (Linux-oriented path).
- `TODO.md` — active daemon backlog.
- `RUNTIME_EXTRACTION.md` — local-first runtime/device extraction plan for CLI and gateway reuse.

---

## 3) Runtime architecture

## 3.1 `emwaver` CLI

Main command groups (`emwaver/src/main.rs`):
- `emwaver start`
- `emwaver daemon start|stop|status|autostart`
- `emwaver daemon serve`
- `emwaver devices`
- `emwaver doctor`
- `emwaver run <script.emw>`
- `emwaver gateway` / `emwaver web`
- `emwaver agent`
- `emwaver tui`
- `emwaver paths`

State paths are resolved via `directories::ProjectDirs`:
- pidfile (daemon process id)
- logfile
- local data dir

CLI provides local device/status, gateway, direct script execution, and Agent helper commands.

The rebirth/local-first direction adds a development gateway command:

```bash
emwaver gateway --port 3921
```

This starts the localhost browser gateway from `gateway/`. It is a bridge toward local script control without Continual cloud auth or hosted relay requirements.

For Linux/headless deployments, the preferred one-command local stack is:

```bash
emwaver start
```

`emwaver start` starts the Rust daemon host in the background, then starts the localhost gateway in the foreground. The browser connects to the gateway, and the gateway forwards scripts and UI events to the daemon host over `/v1/ws`:

```text
localhost browser UI
  <-> localhost gateway
  <-> emwaver daemon host
  <-> emwaver-runtime
  <-> emwaver-device USB MIDI/SysEx or ESP32 BLE transport
  <-> board firmware
```

The daemon host connects to the gateway as `role=host`, executes `script.run`, streams `ui.snapshot`, handles `ui.event`, and reports local daemon/device status. This is the Linux/no-GUI equivalent of a native app connecting to the gateway as `role=app`.

Development and validation flags:

```bash
emwaver start --sim-device
emwaver start --no-device
emwaver start --device 0
emwaver start --ble
emwaver daemon serve --port 3921 --sim-device
emwaver daemon start --port 3921 --device 0
emwaver daemon start --port 3921 --ble
```

The local-first direction also adds:

```bash
emwaver run scripts/blink.emw
```

`emwaver run` reads the local `.emw` file and sends `script.run` to the localhost gateway as a controller client. The gateway then forwards the command to the native EMWaver app connected as `role=app`/`role=host`. The CLI does not own a second hardware runtime in this path.

For headless hosts, direct mode runs the extracted Rust runtime in-process:

```bash
emwaver run scripts/blink.emw --direct
emwaver run scripts/blink.emw --direct --device 0
emwaver run scripts/blink.emw --direct --ble
emwaver run scripts/ui-only.emw --direct --no-device
emwaver run scripts/blink.emw --direct --sim-device
```

Direct mode uses `emwaver-device` for USB MIDI/SysEx hardware access unless `--no-device` is set for UI-only scripts. `--device <id>` selects a USB MIDI input id from `emwaver devices`. `--ble` selects the ESP32 BLE GATT transport and uses the same SysEx/superframe envelope as USB MIDI.
`--sim-device` uses the shared mock EMWaver device simulator so hardware-touching scripts can be smoke-tested without a connected board.

Useful flags:

```bash
emwaver run scripts/blink.emw --port 3930
emwaver run scripts/blink.emw --gateway-url http://127.0.0.1:3930
emwaver run scripts/blink.emw --name blink.emw --timeout-ms 10000
emwaver run scripts/blink.emw --no-wait
emwaver run scripts/blink.emw --direct --bootstrap-path assets/default-scripts/script_bootstrap.emw
```

Local setup can be checked with:

```bash
emwaver doctor
```

`doctor` checks the repo gateway package, `node`, `npm`, `cargo`, `rustc`, MIDI device visibility, and best-effort EMWaver BLE scan visibility.
It also reports the current OS/architecture, local state directory, pidfile, logfile, and non-invasive autostart status so local installs can be debugged without a cloud account.

Agent help is optional and paid. It never gates local hardware control:

```bash
EMWAVER_AGENT_API_KEY=... EMWAVER_AGENT_ENDPOINT=... emwaver agent "write a GPIO blink script"
emwaver agent --script scripts/blink.emw --mode debug "explain this error"
```

`emwaver tui` remains daemon/status-oriented for the rebirth. Script-aware terminal UI is intentionally deferred until local CLI/gateway hardware execution is validated across platforms; the browser gateway is the script-control UI surface for now.

## 3.2 Local daemon host

The old `emwaver-host` backend heartbeat/WebSocket wrapper has been removed from the workspace. It has been replaced by a local-only daemon host.

`emwaver daemon serve` is the foreground host process. It connects to the localhost gateway, owns the `.emw` runtime, and uses `emwaver-device` for USB MIDI/SysEx hardware access unless `--ble`, `--no-device`, or `--sim-device` is selected. The BLE path scans for the EMWaver ESP32 service UUID and writes the same SysEx/superframe payload to the command characteristic while listening on the notify characteristic.

`emwaver daemon start` spawns that same host in the background and writes the pid/log paths under the per-user EMWaver state directory. `emwaver daemon stop` sends SIGTERM to the recorded pid.

This daemon does not heartbeat to a hosted backend, register a cloud session, require an account, enforce subscriptions, or expose USB hardware to a remote service.

## 3.3 Script/UI engine

`emwaver-runtime/src/engine.rs`:
- uses Boa JS runtime,
- loads script bootstrap,
- registers host bridge callbacks (`_scriptRender`, `_scriptSendPacket`, callback registry),
- stores latest UI tree and metadata,
- dispatches UI events by handler token.

`emwaver-device/src/device.rs` owns the reusable USB MIDI/SysEx transport used by direct local execution. `emwaver-device/src/ble.rs` owns the reusable ESP32 BLE transport using the same protocol envelope.

This is model-1 parity behavior: headless host still owns authoritative UI state machine.

---

## 4) Protocol and remote control behavior

Inbound WS messages handled include:
- `hello.ack`
- `script.run`
- `script.stop`
- `ui.event`

Outbound host messages include:
- `hello`
- `device.status`
- `script.started`
- `script.stopped`
- `ui.snapshot`
- `script.error` (when appropriate)

Snapshots are sent when tree changes (revision increments).

---

## 5) Device/transport ownership

Daemon-side transport is local USB MIDI/SysEx by default, with ESP32 BLE available through `--ble`.

- Device detection/listing uses MIDI port enumeration and a short EMWaver BLE scan.
- `emwaver daemon start --device <id>` pins the host to a listed USB MIDI input id.
- `emwaver daemon start --ble` uses ESP32 BLE service discovery instead of USB MIDI.
- Device command path routes through the local USB or BLE command bridge and shared packet send/response semantics.
- Remote side never directly owns USB/BLE — only forwards commands/events through daemon session.

This model applies to host-backed boards. Autonomous Wi-Fi-capable boards are expected to use a different direct session model once implemented.

---

## 6) Autostart/service posture

Current support posture:
- macOS: launchd detection/check path in CLI (plist presence check)
- Linux: systemd unit detection/check path

Planned direction:
- polished launchd/systemd setup flows,
- single-command installer UX for Linux hosts.

---

## 7) Development workflow

From repo root:

```bash
./daemon/dev devices
./daemon/dev daemon status
```

`daemon/dev` compiles both daemon binaries and executes CLI commands (fast iterative workflow).

Alternative direct cargo usage:

```bash
cd daemon
cargo run -p emwaver -- daemon status
cargo run -p emwaver -- run ../scripts/example.emw --direct --no-device
```

---

## 8) Environment variables

Common runtime envs:
- `EMWAVER_BOOTSTRAP_PATH`
- `EMWAVER_DEVICE_ID`
- `EMWAVER_AGENT_API_KEY`
- `EMWAVER_AGENT_ENDPOINT`
- `RUST_LOG`

---

## 9) Design constraints

1. USB ownership is local to daemon host for host-backed boards.
2. Daemon is headless by design (no rendered UI surface).
3. Keep gateway protocol compatibility with the localhost app-role bridge.
4. Avoid coupling daemon update flows with GUI firmware update features.

---

## 10) Documentation maintenance rule

When changing daemon protocol, runtime loop, or local service lifecycle behavior:
- update `daemon/README.md`,
- update any controller-side docs that depend on message contract.
