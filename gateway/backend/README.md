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
```

Hardware transports are selected when the Gateway starts:

```sh
cargo run -p emwaver -- gateway serve --device 0
cargo run -p emwaver -- gateway serve --ble
cargo run -p emwaver -- gateway serve --wifi 192.168.1.44
```

Install a Linux user service:

```sh
cargo run -p emwaver -- service install --sim-device --now
```

The service runs `emwaver gateway serve ...` and writes `emwaver-gateway.service`.
