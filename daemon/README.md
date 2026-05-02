# EMWaver Headless Daemon (`/daemon`)

Rust-based headless host for EMWaver.

This is the terminal/service runtime that keeps USB ownership local to a machine (Mac/Linux target direction), while exposing remote control through EMWaver cloud protocols.

It is one remote-control path in the platform, not the only remote architecture. Autonomous board classes such as future ESP32 direct-to-cloud targets can bypass the daemon entirely.

---

## 1) Purpose

The daemon is the **no-UI host runtime** for host-backed boards:
- owns USB connection to the EMWaver hardware,
- runs the script runtime and UI state machine headlessly,
- forwards snapshots/events over WebSocket (`/v1/ws`) to remote controllers.

It is intended for always-on hosts (desktop, laptop, Raspberry Pi), not as a replacement for native GUI apps.

Firmware update UX remains in GUI apps; daemon focuses on host/runtime control.

---

## 2) Workspace layout

- `emwaver/` — CLI binary (`emwaver`) for daemon/device/status operations.
- `emwaver-host/` — long-running daemon runtime.
- `dev` — convenience build/run wrapper.
- `install/install.sh` — install helper (Linux-oriented path).
- `systemd/emwaver-host.service` — sample service unit.
- `TODO.md` — active daemon backlog.
- `RUNTIME_EXTRACTION.md` — local-first runtime/device extraction plan for CLI and gateway reuse.

---

## 3) Runtime architecture

## 3.1 `emwaver` CLI

Main command groups (`emwaver/src/main.rs`):
- `emwaver daemon start|stop|status|autostart`
- `emwaver devices`
- `emwaver doctor`
- `emwaver run <script.emw>`
- `emwaver gateway` / `emwaver web`
- `emwaver tui`
- `emwaver paths`

State paths are resolved via `directories::ProjectDirs`:
- pidfile (daemon process id)
- logfile
- local data dir

CLI can start `emwaver-host` in background, pass env overrides, and provide a minimal status TUI.

The rebirth/local-first direction adds a development gateway command:

```bash
emwaver gateway --port 3921
```

This starts the localhost browser gateway from `gateway/`. It is a bridge toward local script control without Continual cloud auth or hosted relay requirements.

The local-first direction also adds:

```bash
emwaver run scripts/blink.emw
```

`emwaver run` reads the local `.emw` file and sends `script.run` to the localhost gateway as a controller client. The gateway then forwards the command to the native EMWaver app connected as `role=app`/`role=host`. The CLI does not own a second hardware runtime in this path.

Useful flags:

```bash
emwaver run scripts/blink.emw --port 3930
emwaver run scripts/blink.emw --gateway-url http://127.0.0.1:3930
emwaver run scripts/blink.emw --name blink.emw --timeout-ms 10000
emwaver run scripts/blink.emw --no-wait
```

Local setup can be checked with:

```bash
emwaver doctor
```

`doctor` checks the repo gateway package, `node`, `npm`, `cargo`, `rustc`, and MIDI device visibility.

## 3.2 `emwaver-host` daemon

Entry (`emwaver-host/src/main.rs`) does:
1. load config from env (`EMWAVER_BACKEND_URL`, token, host session id),
2. read bootstrap script,
3. auto-connect local MIDI device (`device.connect_auto()`),
4. initialize script engine,
5. heartbeat host presence (`/v1/hosts/heartbeat`),
6. connect WS (`/v1/ws`) as `role=host`,
7. process incoming remote commands and publish UI snapshots.

Reconnect loop is built-in with retry delay.

## 3.3 Script/UI engine

`emwaver-host/src/engine.rs`:
- uses Boa JS runtime,
- loads script bootstrap,
- registers host bridge callbacks (`_scriptRender`, `_scriptSendPacket`, callback registry),
- stores latest UI tree and metadata,
- dispatches UI events by handler token.

This is model-1 parity behavior: headless host still owns authoritative UI state machine.

---

## 4) Protocol and remote control behavior

Inbound WS messages handled include:
- `hello.ack`
- `host.attach`
- `script.run`
- `ui.event`

Outbound host messages include:
- `script.started`
- `ui.snapshot`
- `script.error` (when appropriate)

Snapshots are sent when tree changes (revision increments).

---

## 5) Device/transport ownership

Daemon-side transport is local USB.

- Device detection/listing uses MIDI port enumeration.
- Device command path routes through local `Device` abstraction and packet send/response semantics.
- Remote side never directly owns USB — only forwards commands/events through daemon session.

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
./daemon/dev daemon start
./daemon/dev daemon status
```

`daemon/dev` compiles both daemon binaries and executes CLI commands (fast iterative workflow).

Alternative direct cargo usage:

```bash
cd daemon
cargo run -p emwaver -- daemon status
cargo run -p emwaver-host
```

---

## 8) Environment variables

Common runtime envs:
- `EMWAVER_BACKEND_URL`
- `EMWAVER_ID_TOKEN`
- `EMWAVER_HOST_SESSION_ID`
- `EMWAVER_BOOTSTRAP_PATH`
- `RUST_LOG`

If auth token is missing, behavior may work only in limited/dev scenarios depending on backend auth mode.

---

## 9) Design constraints

1. USB ownership is local to daemon host for host-backed boards.
2. Daemon is headless by design (no rendered UI surface).
3. WS protocol compatibility with backend host routing is mandatory.
4. Keep reconnection and heartbeat robust for unattended service operation.
5. Avoid coupling daemon update flows with GUI firmware update features.

---

## 10) Documentation maintenance rule

When changing daemon protocol, runtime loop, or service lifecycle behavior:
- update `daemon/README.md`,
- update backend WS/hosts docs if server expectations changed,
- update any controller-side docs that depend on message contract.
