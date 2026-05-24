# Linux App (`/linux`)

Native Linux EMWaver application workspace.

This is the Rust + GTK4/libadwaita port track described in `docs/LINUX_GTK4_PORT_PLAN.html`. It is a new native app, not a revival of the removed Gateway, browser UI, or CLI control plane.

Local-first rules:
- local scripts, simulator mode, device discovery, and firmware setup must not require an EMWaver account, cloud activation, hosted relay, subscription check, device registration, or hardware ownership gate;
- optional Agent replies use a user-provided API key and public `/api/mgpt/...` endpoints;
- scripts and app state stay on the user's Linux machine by default.

## Workspace layout

- `crates/emwaver-linux-app` - GTK4/libadwaita app shell.
- `crates/emwaver-linux-core` - app model, local device registry, script-session lifecycle.
- `crates/emwaver-linux-transport` - common transport traits plus simulator/USB/BLE/Wi-Fi adapters.
- `crates/emwaver-linux-firmware` - STM32 DFU and ESP32 serial flashing orchestration.
- `crates/emwaver-linux-agent` - optional MGPT Agent API client and secret-store boundary.
- `resources/udev/99-emwaver.rules` - Linux device access rules for supported run/update modes.

## Current implementation status

The first native slice is M0/M1:
- simulator device loads the shared `simulator/fixtures/basic-board.json`;
- core registry deduplicates records by local hardware UID when present;
- script sessions enforce selected-device claims and busy-device rejection;
- Agent and firmware crates expose local-first orchestration boundaries without storing secrets or flashing real hardware yet;
- the app crate contains a GTK4/libadwaita shell that shows the simulator, script editor controls, log output, firmware and Agent panels.

USB, BLE, Wi-Fi, real firmware flashing, and packaged installers are staged behind the crate boundaries and are not complete yet.

## Build and validation

Core crates can be validated on any Rust host:

```sh
cargo test --manifest-path linux/Cargo.toml --workspace --exclude emwaver-linux-app
```

The GTK app requires Linux development packages for GTK4, libadwaita, and GtkSourceView 5. On Ubuntu/Debian:

```sh
sudo apt install libgtk-4-dev libadwaita-1-dev libgtksourceview-5-dev pkg-config
cargo run --manifest-path linux/Cargo.toml -p emwaver-linux-app
```

Do not add a localhost daemon or browser relay to make the app run. Hardware transports belong in-process behind `emwaver-linux-transport`.

