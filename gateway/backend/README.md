# EMWaver Gateway Backend

This folder owns the Rust side of the local Gateway:

- `emwaver/` - `emwaver` CLI and localhost Gateway backend.
- `emwaver-runtime/` - `.emw` runtime, UI tree, timers, plots, and simulator bridge.
- `emwaver-device/` - USB MIDI/SysEx, ESP32 BLE, and ESP32 Wi-Fi device transports.
- `install/` - source-checkout installer for the CLI and built frontend assets.

The backend is local-first and account-free. It does not host Agent logic, product accounts, cloud control, script sync, or native app control. Agent and UI tooling belong in TypeScript under `gateway/frontend/` or adjacent TypeScript tooling.

## Commands

```sh
cd gateway/backend
cargo build -p emwaver
cargo test -p emwaver-runtime -p emwaver-device
```

Run the local Gateway in the foreground:

```sh
cargo run -p emwaver -- gateway serve --sim-device
```

Run a script through a running Gateway:

```sh
cargo run -p emwaver -- run ../../assets/default-scripts/hello.emw
cargo run -p emwaver -- scripts
cargo run -p emwaver -- ui snapshot <script-instance-id> --json
cargo run -p emwaver -- ui event <script-instance-id> --target <node-id> --name tap
cargo run -p emwaver -- script stop <script-instance-id>
```

The script observability direction is UI-only. The migration in
[`../../docs/UI_SNAPSHOT_RUNTIME_MIGRATION.md`](../../docs/UI_SNAPSHOT_RUNTIME_MIGRATION.md)
removes script-visible `console.*` APIs and `script.log` forwarding. `emwaver run`
starts a Gateway-owned session and returns the script instance id; terminal and
Agent workflows inspect `ui.snapshot`, send `ui.event`, list sessions, and stop
sessions through Gateway commands.

Gateway discovers available hardware transports while it runs. Startup flags can
seed discovery with a specific wired or Wi-Fi target:

```sh
cargo run -p emwaver -- gateway serve --device 0
cargo run -p emwaver -- gateway serve --ble
cargo run -p emwaver -- gateway serve --wifi 192.168.1.44
```

BLE discovery/control is enabled with `--ble`. On macOS it is opt-in because
continuous background CoreBluetooth polling can destabilize long-running
Gateway processes.

`emw devices`, browser status, and `/v1/devices` report Gateway-owned discovery
state when Gateway is running. Physical devices are exposed only after a
successful local hardware UID read. Multi-transport ESP boards stay discoverable
over USB/BLE/Wi-Fi, but script/control traffic claims one selected transport for
the active session; the other transports remain identity/status-only until the
session stops.

Install a Linux user service:

```sh
cargo run -p emwaver -- service install --sim-device --now
```

The service runs `emwaver gateway serve ...` and writes `emwaver-gateway.service`.
