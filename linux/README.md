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
- `crates/emwaver-linux-runtime` - JavaScript-facing runtime compiler and command-step generation.
- `crates/emwaver-linux-transport` - common transport traits plus simulator/USB/BLE/Wi-Fi adapters.
- `crates/emwaver-linux-firmware` - STM32 DFU and ESP32 serial flashing orchestration.
- `crates/emwaver-linux-agent` - optional MGPT Agent API client and secret-store boundary.
- `resources/udev/99-emwaver.rules` - Linux device access rules for supported run/update modes.

## Current implementation status

The first native slice is M0/M1:
- simulator device loads the shared `simulator/fixtures/basic-board.json`;
- core registry deduplicates records by local hardware UID when present;
- script sessions enforce selected-device claims and busy-device rejection;
- USB discovery classifies STM32 run-mode USB MIDI, STM32 DFU, and common ESP32 serial adapters with permission diagnostics;
- Rust USB MIDI SysEx/superframe codec matches the STM32 fixed 36-byte superframe, 48-byte SysEx, and 64-byte USB-MIDI transaction contract;
- STM32 run-mode USB MIDI transport can open the discovered device, claim the MIDI interface, send encoded superframes, and read decoded response superframes;
- shared command probes read firmware version, board type, and local hardware UID over any transport implementation;
- transport-backed command script execution can run command-lane steps over any transport, stop on busy/error responses, and produce a local execution report;
- JavaScript runtime compiler supports early `emw.command`, `device.*`, and `gpio.*` APIs and emits transport command steps for the runner;
- the runtime crate exports both JavaScript compilation and execution entry points for the GTK app;
- the GTK Run button routes selected simulator and STM32 USB MIDI devices through the JavaScript runtime and transport runner;
- the GTK shell seeds discovered USB candidates into the local device list alongside the simulator and probes accessible STM32 run-mode boards for local metadata;
- the GTK shell is now script-workspace first, loads the shared `assets/default-scripts` bundle, groups scripts as Examples/Libraries/Kernel/Custom Scripts, keeps bundled scripts read-only, and supports local New/Save/Make Copy behavior aligned with the macOS and Windows script workspace;
- the firmware crate can plan bundled STM32 and ESP32-S3 images, validate required bundled assets, and flash STM32 DFU through the existing Rust DFU backend;
- the Agent crate uses the public MGPT `universe`/`userInput` request shape, folds local context into user-visible input, and exposes typed hardware primitive command builders for `spi_transfer`, `gpio_mode`, `gpio_write`, `gpio_read`, and `analog_read`;
- Agent and firmware crates expose local-first orchestration boundaries without storing secrets or gating local hardware access;
- the app crate contains a GTK4/libadwaita shell that shows the simulator, script editor controls, log output, local device metadata, firmware, settings, and Agent panels.

Full JavaScript runtime parity beyond the initial command/gpio/device API, BLE, Wi-Fi, real firmware flashing, and packaged installers are staged behind the crate boundaries and are not complete yet.

## Build and validation

Core crates can be validated on any Rust host:

```sh
cargo test --manifest-path linux/Cargo.toml --workspace --exclude emwaver-linux-app
```

The GTK app requires Linux development packages for GTK4, libadwaita, and GtkSourceView 5. On Ubuntu/Debian:

```sh
sudo apt install libgtk-4-dev libadwaita-1-dev libgtksourceview-5-dev libgraphene-1.0-dev pkg-config
cargo run --manifest-path linux/Cargo.toml -p emwaver-linux-app
```

Do not add a localhost daemon or browser relay to make the app run. Hardware transports belong in-process behind `emwaver-linux-transport`.
