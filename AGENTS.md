# EMWaver Repository Guidelines

## Project Summary
EMWaver is a comprehensive open-source hardware/software ecosystem for wireless experimentation and hardware hacking, built around a custom ESP32-S3 development board plus low-cost STM32 variants.

EMWaver aims to replace much of the quick-prototyping workflow people reach for with platforms like Arduino, while also targeting Flipper Zero-style portability by shifting UI/compute onto the phone and keeping the hardware focused on reliable I/O and radio capabilities.

Guiding question: how fast can you fully exploit any sensor/chip/module that a microcontroller can control—not just “read a register”, but unlock the full surface area with a real UI—ideally in minutes via Wavelets and the desktop IDE.

### Core Goals & Vision
1. **Hardware democratization**: interact with and control wireless protocols (Sub-GHz RF, IR, GPIO, USB, etc.) through a unified mobile/desktop interface without requiring custom firmware per use case.
2. **Wavelet extension system**: a JavaScript-based plugin architecture that enables custom UIs and hardware interactions without modifying core firmware or building native apps.
3. **Cross-platform parity**: full feature parity across Android, iOS, Desktop, and CLI interfaces.

### Hardware Architecture
- **Core**: ESP32-S3 MCU with Wi‑Fi, Bluetooth LE, and USB OTG
- **RF subsystem**: CC1101 transceiver for 315/433/868/915 MHz experimentation
- **USB connectivity**: dual USB‑C ports (male for device emulation, female for programming)
- **Expandability**: GPIO headers for custom modules and sensors
- **Target uses**: RF signal analysis, IR remote cloning, GPIO control, USB device emulation

### Device Lines
- **Flagship (ESP32, BLE-first)**: 3 devices; more powerful, general-purpose, phone-controlled.
- **Low-cost (STM32, USB-first)**: 4 devices; smaller/tailored form factors that communicate via USB (not BLE), often focused on a specific application.
- **Phone-first portability**: boards use a vertical male USB‑C plug so the PCB can connect directly to a phone; the phone provides CPU, power, memory, and UI rather than adding buttons/displays on-device.

## Overview
- **ESP32 Firmware**: ESP32-S3 firmware in `esp/` with modules in `esp/main/`
- **STM32 Firmware**: STM32 firmware projects in `stm/`
- **Android**: Native Android companion app in `android/`
- **iOS**: SwiftUI companion app in `ios/`
- **Desktop App**: Cross-platform EMWaver app in `app/` (Tauri) - mirrors all mobile views/fragments and includes an IDE fragment
- **CLI**: Rust command-line tool in `cli/` for device interaction
- **VS Code Extension**: VS Code extension in `vsc/` (WIP) for build/flash workflows via the CLI
- **Hardware**: PCB and mechanical artifacts in `hardware/`
- **Docs**: MkDocs-based documentation in `docs/`

## Environment Skills & Worktrees
This repo previously included local tmux helpers, but they have been removed; follow per-platform build instructions in the relevant subprojects instead (`esp/`, `stm/`, `cli/`, `docs/`, `android/`, `ios/`, `app/`, `vsc/`).

## Project Structure & Module Organization
ESP32 firmware lives in `esp/` (ESP-IDF project) and is split into modules in `esp/main/` (e.g., `ble_server.c`, `cc1101.c`, `mfrc522.c`, `badusb.c`) with matching headers. ESP-IDF managed components live under `esp/managed_components/`; regenerate them with `idf.py reconfigure` rather than editing by hand. STM32 firmware lives in `stm/` as multiple focused projects; treat CubeMX-generated output as generated code (regenerate rather than hand-editing the generated layers). Companion apps sit under `android/`, `ios/`, and `app/` (desktop), while `docs/` with `mkdocs.yml` drives the user-facing site. The Rust CLI tool lives in `cli/`. Treat `build/` folders and generated `.elf`/`.bin`/`.dfu` artifacts as temporary.

## Buffer Protocol Shared Core (Migration Plan)

EMWaver uses a simple **64-byte framing + append-only RX capture + cursor parsing** model described in `docs/content/documentation/buffer.md`.
Today, core buffer logic is duplicated across platforms (Desktop Rust, Android JNI/C++, iOS Swift) and has started to drift.

### Goal
- Establish a single canonical implementation of the buffer/packet algorithms in **Rust** (so Desktop works immediately).
- Keep transport I/O (BLE scanning, GATT plumbing, USB APIs) platform-specific; only unify the deterministic byte-level logic.

### Canonical Core Scope (Rust)
The shared core must contain only pure logic (no platform I/O):
- **Packet framing**: fixed `PACKET_SIZE = 64`, padding rules, slicing helpers.
- **Log buffer model**: append-only RX byte capture, per-completed-packet timestamps, TX packet logging, RX cursor (`rx_counter`) consumption.
- **Status parsing**: consistent handling of `BS` flow-control status packets (ESP32/STM32 retransmit) with a specified API.
- **Sampler viewport compression**: bit min/max downsampling used for chart rendering (match Android/iOS behavior).
- **Retransmit pacing policy**: optional pure state machine to tune chunk size/delay based on `BS` status (policy-only; transport sends bytes).

### Out of Scope (per-platform)
- BLE/USB discovery, permissions, MTU negotiation, threading/queues, notification subscription, serial drivers.
- UI rendering and JS bridge glue.

### Implementation Path
1. Create `cli/src/transport_core/` (or similar) in the `emw` crate to host the shared core types and functions.
2. Move Desktop/Tauri code to consume the shared core (replace `app/src-tauri/src/buffer.rs` logic with calls into `emw`).
3. Add **parity tests** in Rust (golden vectors) for buffer operations, `BS` parsing, and compression.
4. Integrate the Rust core into mobile apps via **FFI now**:
   - **iOS**: ship the core as a static library/XCFramework and expose a stable API to Swift (prefer UniFFI-generated Swift bindings or a minimal C ABI wrapper).
   - **Android**: ship the core as `jniLibs` `.so` binaries with generated Kotlin bindings (prefer UniFFI Kotlin bindings; otherwise JNI wrappers).
   - Keep the FFI boundary small (bytes in/out, counters, timestamps) and keep all transport I/O (CoreBluetooth/Android BLE/USB) native.

### Guardrails
- Any behavior change to parsing/framing must be reflected in `docs/content/documentation/buffer.md` and golden tests.
- Prefer compatibility over redesign; do not change on-wire semantics during the migration.

## Wavelet Feature
Wavelets are the user-authored extension bundles (manifest + JavaScript) that plug into the Wavelet Engine sandbox to broaden EMWaver beyond the built-in fragments. They combine UI declarations with scripted logic that talks to firmware through the EMWaver Script SDK. Refer to `TODO.md` for the evolving roadmap, packaging details, and open questions.

- **Parity-first UI DSL**: treat the Wavelet UI description language as a thin translation layer over our native SwiftUI/Compose capabilities. Aim for feature parity with existing Swift views, while keeping the DSL portable so Android renders the same layout from the same script. Any new component should be exposed in a way that both platforms can implement consistently.
- **Unified scripting engine**: WaveletEngine is the single runtime for both interactive UI wavelets and CLI-style scripts. All native bridges (CC1101, BLE, Utils, IR) must be injected here so scripts do not depend on the deprecated ScriptsEngine.
- **In-wavelet logging**: scripts surface their output through Wavelet UI components (e.g., `UI.logViewer`) instead of the legacy console text pane. Avoid adding new out-of-band logging surfaces.

## Wavelet Development & File Sync
Wavelets and signal assets are managed via **Git/GitHub as the source of truth**. Both mobile apps and desktop app sync with a configured GitHub repository.

**Key Design Points**:
- **Git as source of truth**: Wavelet `.js` files and signal assets live in a GitHub repository
- **Mobile Git fragment**: UI section in Android/iOS for GitHub repo operations (clone, pull, push)
- **Desktop authoring**: Desktop app (`app/`) clones repo locally, provides rich editor + preview, mirrors all mobile views/fragments
- **Workflow**: Desktop authors → commits/pushes to GitHub → mobile apps pull when needed
- **No accounts/backend**: Uses GitHub REST API with token-based auth; no custom cloud service

**Mobile Git Operations** (via Git fragment UI):
- Configure GitHub repository and personal access token
- Clone/pull wavelet assets from repo
- Push local changes to repo
- Status indicators and conflict resolution

**Desktop Workflow**:
- Clone GitHub repo locally
- Edit wavelets with syntax highlighting, linting, templates
- Live preview before committing
- Commit and push changes to GitHub

## Cross-Cutting Practices
- Keep commits scoped and imperative (e.g., `driver: fix cc1101 init`, `android: update wavelet renderer`); never bundle unrelated changes.
- Secrets must stay out of Git—BLE pairing keys, Wi-Fi credentials use Kconfig defaults or NVS at runtime.
- Confirm required tests before pushing: firmware host tests (`pytest -m host_test`).
- Prefer existing tooling (ESP-IDF, Gradle, Xcode, Cargo); avoid introducing new frameworks without clear benefits.

## Project Playbooks

### ESP32 Firmware (`/esp`)
- Firmware modules live in `esp/main/` (e.g., `ble_server.c`, `cc1101.c`, `mfrc522.c`, `badusb.c`); regenerate ESP-IDF managed components with `idf.py reconfigure` instead of editing generated files.
- **Environment**: `cd esp && source setup.sh`, then `idf.py set-target esp32s3`, `idf.py build`, `idf.py -p <port> flash`, `idf.py monitor`; keep hardware ports configurable per developer.
- **Coding style**: 4-space indent, K&R braces, `snake_case`, `static` internals, ESP-IDF headers before project headers; Python helpers follow Black defaults.
- **Command protocol**: every control packet is ASCII using Unix-style verbs and flags (e.g., `spi --open --name cc1101 --port 2 --miso 13 --mosi 11 --sck 12 --cs 10 --clock 8000000`). Current firmware supports hardware-agnostic SPI operations (`--open`, `--read`, `--write`, `--close` with `--data` hex payloads) and sampler routing (`sample --start --mode pwm --channel 3 --freq 25000 --duty 0.4`, `sample --stop`). Responses echo the same structure (`ok ...`, `err ...`) so smartphone and CLI clients stay aligned.
- **BLE services**: Custom service (UUID `45c7158e-...`) exposes command characteristic (write) and notification characteristic (read) for device control commands.
- **Testing**: flash to hardware for smoke verification, extend `pytest_hello_world.py` with `@pytest.mark.host_test` suites, and document timing-sensitive paths inline.
- **Build commands**:
```bash
cd esp
source setup.sh
idf.py set-target esp32s3
idf.py build
idf.py -p /dev/ttyACM0 flash
idf.py monitor
pytest -m host_test
```
Replace the serial device as appropriate for your platform. Use `idf.py clean` only when caches become inconsistent.

### STM32 Firmware (`/stm`)
- `stm/` contains multiple STM32 firmware projects (often one per device/application).
- STM32 devices communicate via USB (not BLE) and support DFU-based flashing for fast iteration.
- Flashing utilities exist across the ecosystem:
  - Android DFU helper: `android/app/src/main/java/com/emwaver/emwaverandroidapp/ui/flash/Dfu.java`
  - Desktop DFU bridge: `app/src-tauri/src/lib.rs` (uses the shared Rust DFU implementation)
  - CLI DFU implementation: `cli/src/dfu.rs` (exposed via `emwaver` commands)
- When CubeMX regeneration is required, treat CubeMX output as generated code; keep handwritten logic in the intended user-edit regions/layers and prefer regeneration over manual edits to generated files.

> **Agent Note:** Do not run `xcodebuild` (or other iOS build commands) from the CLI; leave iOS builds to be run manually in Xcode by the user.

> **Agent Note:** Do not run `./gradlew assembleDebug`, `./gradlew installDebug`, or other Android build commands from the CLI; the user builds manually. Exception: if the user explicitly requests a build for debugging purposes when troubleshooting errors.

### Android (`/android`)
- Gradle project; run `./gradlew installDebug` for device builds. Keep `local.properties` pointing at the SDK (typically `~/Library/Android/sdk` or `~/Android/Sdk`).
- **Git fragment**: UI section for GitHub repo operations (clone, pull, push) using GitHub REST API with token-based auth.
- Wavelet console/sampler loads `.js` and `.raw` assets from local storage (synced via Git fragment).
- Mirror iOS feature parity for wavelets, IR tooling, and hardware interaction.
- **Logcat filtering**: To view logs only from the EMWaver Android app, use: `adb logcat --pid=$(adb shell pidof -s com.emwaver.emwaverandroidapp) -T 0`. The `--pid` flag filters by process ID, and `-T 0` clears the buffer and shows logs from the current time forward.

### iOS (`/ios`)
- SwiftUI app opened via `EMWaver.xcodeproj`; mirror Android feature parity.
- **Git fragment**: UI section for GitHub repo operations (clone, pull, push) using GitHub REST API with token-based auth.
- Wavelet renderers, IR tooling, and hardware communication must stay aligned with the Android app.
- Build and test through Xcode; agents should not invoke `xcodebuild` from CLI.

### CLI (`/cli`)
- Rust binary using Clap for device interaction workflows.
- **Shell integration**: the `emwaver shell` command discovers nearby devices, pairs over the same transport as smartphones, and provides an interactive prompt that sends raw Unix-style commands (SPI control, sampler routing) and prints structured `ok ...`/`err ...` responses for scripting or operator use.
- Development: `cargo build`, `cargo run`, `cargo test`
- Distribution artifacts and installers may be prepared for macOS/Linux/Windows.

### Desktop App (`/app`, formerly `/ide`)
- Cross-platform EMWaver app (Tauri) that mirrors all mobile views/fragments (same UI components as Android/iOS).
- **UI Parity**: All mobile fragments/views (wavelets, IR, sampler, Git fragment, etc.) available on desktop.
- **Features**: Rich editor (syntax highlighting, linting, templates), live preview, local Git repo clone, commit/push to GitHub, full hardware interaction capabilities.
- **IDE fragment**: firmware editor + terminal to accelerate hardware bring-up and iteration.
  - Project creation/open for ESP32 and STM32 targets with EMWaver-ready scaffolds (communication interfaces, sampler, and common modules).
  - Integrated terminal UI (xterm.js) with a cross-platform PTY backend (portable-pty via Rust).
  - Orchestrates build/flash by platform: ESP32 via `idf.py`; STM32 via CubeMX (when code generation is needed) + `arm-none-eabi-gcc`, plus DFU flows for supported devices.
- Development environment and build instructions specific to the desktop app tooling.

### VS Code Extension (`/vsc`)
- VS Code extension scaffold for a simple **Build & Flash** sidebar, delegating to the `emwaver` CLI (`emwaver build` / `emwaver flash`).
- Dev workflow is documented in `vsc/README.md`.

### Docs (`/docs`)
- MkDocs project with user-facing documentation.
- Build with `mkdocs build`, serve locally with `mkdocs serve`.
- Keep documentation synchronized with firmware command protocol, wavelet SDK, and mobile app features.

## Security & Configuration Notes
- Never commit credentials, BLE pairing keys, or Wi-Fi secrets; use Kconfig defaults or NVS at runtime.
- Mirror intentional configuration changes in `sdkconfig.ci` and document new persistent layouts in `docs/` so downstream tooling stays aligned.
- Regenerate `sdkconfig.ci` whenever firmware configuration changes.

## Operational Guardrails
- Treat build artifacts (`build/`, `.elf`, `.bin`) as disposable; avoid committing them.
- Document timing-critical code paths and hardware-specific configurations inline.

## Agent Workflow Guardrails
- Do **not** `git commit` or `git push` unless the user explicitly requests it in the current conversation.
