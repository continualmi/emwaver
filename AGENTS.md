# EMWaver Repository Guidelines

## Overview
- **Firmware**: ESP32-S3 firmware at repository root with modules in `main/`
- **Android**: Native Android companion app in `android/`
- **iOS**: SwiftUI companion app in `ios/`
- **CLI**: Rust command-line tool in `cli/` for device interaction and file sync
- **IDE**: Cross-platform EMWaver programmer in `ide/`
- **Docs**: MkDocs-based documentation in `docs/`

## Environment Skills & Worktrees
When the user asks to start or restart any environment, refer to `skills/environment/setup.md` for detailed orchestration steps. Launch necessary tmux helpers directly from their roots and only escalate to troubleshooting when something fails.

## Project Structure & Module Organization
Firmware for the ESP32-S3 resides in `main/` and is split into modules (`ble_server.c`, `cc1101.c`, `mfrc522.c`, `badusb.c`) with matching headers. ESP-IDF managed components live in `managed_components/`; regenerate them with `idf.py reconfigure` rather than editing by hand. Companion apps sit under `android/` and `ios/`, while `docs/` with `mkdocs.yml` drives the user-facing site. CLI tool lives in `cli/` and IDE in `ide/`. Treat `build/` and generated `.elf`/`.bin` files as temporary artifacts.

## Wavelet Feature
Wavelets are the user-authored extension bundles (manifest + JavaScript) that plug into the Wavelet Engine sandbox to broaden EMWaver beyond the built-in fragments. They combine UI declarations with scripted logic that talks to firmware through the EMWaver Script SDK. Refer to `TODO.md` for the evolving roadmap, packaging details, and open questions.

- **Parity-first UI DSL**: treat the Wavelet UI description language as a thin translation layer over our native SwiftUI/Compose capabilities. Aim for feature parity with existing Swift views, while keeping the DSL portable so Android renders the same layout from the same script. Any new component should be exposed in a way that both platforms can implement consistently.
- **Unified scripting engine**: WaveletEngine is the single runtime for both interactive UI wavelets and CLI-style scripts. All native bridges (CC1101, BLE, Utils, IR) must be injected here so scripts do not depend on the deprecated ScriptsEngine.
- **In-wavelet logging**: scripts surface their output through Wavelet UI components (e.g., `UI.logViewer`) instead of the legacy console text pane. Avoid adding new out-of-band logging surfaces.

## Cross-Cutting Practices
- Keep commits scoped and imperative (e.g., `driver: fix cc1101 init`, `android: update wavelet renderer`); never bundle unrelated changes.
- Secrets must stay out of Git—BLE pairing keys, Wi-Fi credentials use Kconfig defaults or NVS at runtime.
- Confirm required tests before pushing: firmware host tests (`pytest -m host_test`).
- Prefer existing tooling (ESP-IDF, Gradle, Xcode, Cargo); avoid introducing new frameworks without clear benefits.

## Project Playbooks

### Firmware (Repository Root)
- Firmware lives in `main/` (modules such as `ble_server.c`, `cc1101.c`, `mfrc522.c`, `badusb.c`); regenerate ESP-IDF managed components with `idf.py reconfigure` instead of editing generated files.
- **Environment**: `source setup.sh`, then `idf.py set-target esp32s3`, `idf.py build`, `idf.py -p <port> flash`, `idf.py monitor`; keep hardware ports configurable per developer.
- **Coding style**: 4-space indent, K&R braces, `snake_case`, `static` internals, ESP-IDF headers before project headers; Python helpers follow Black defaults.
- **Command protocol**: every control packet is ASCII using Unix-style verbs and flags (e.g., `spi --open --name cc1101 --port 2 --miso 13 --mosi 11 --sck 12 --cs 10 --clock 8000000`). Current firmware supports hardware-agnostic SPI operations (`--open`, `--read`, `--write`, `--close` with `--data` hex payloads) and sampler routing (`sample --start --mode pwm --channel 3 --freq 25000 --duty 0.4`, `sample --stop`). Responses echo the same structure (`ok ...`, `err ...`) so smartphone and CLI clients stay aligned.
- **Testing**: flash to hardware for smoke verification, extend `pytest_hello_world.py` with `@pytest.mark.host_test` suites, and document timing-sensitive paths inline.
- **Build commands**:
```bash
idf.py set-target esp32s3
idf.py build
idf.py -p /dev/ttyACM0 flash
idf.py monitor
pytest -m host_test
```
Replace the serial device as appropriate for your platform. Use `idf.py clean` only when caches become inconsistent.

> **Agent Note:** Do not run `xcodebuild` (or other iOS build commands) from the CLI; leave iOS builds to be run manually in Xcode by the user.

> **Agent Note:** Do not run `./gradlew assembleDebug`, `./gradlew installDebug`, or other Android build commands from the CLI; the user builds manually. Exception: if the user explicitly requests a build for debugging purposes when troubleshooting errors.

### Android (`/android`)
- Gradle project; run `./gradlew installDebug` for device builds. Keep `local.properties` pointing at the SDK (typically `~/Library/Android/sdk` or `~/Android/Sdk`).
- Wavelet console/sampler can sync `.js` and `.raw` assets locally or through future cloud sync capabilities.
- Login/registration flows may integrate with future backend services for entitlement management.
- Mirror iOS feature parity for wavelets, IR tooling, and hardware interaction.

### iOS (`/ios`)
- SwiftUI app opened via `EMWaver.xcodeproj`; mirror Android feature parity.
- Wavelet renderers, IR tooling, and hardware communication must stay aligned with the Android app.
- Build and test through Xcode; agents should not invoke `xcodebuild` from CLI.

### CLI (`/cli`)
- Rust binary using Clap for `login`, `clone`, `status`, `diff`, `add`, `pull`, `push`, and `logout` flows.
- **Shell integration**: the `emwaver shell` command discovers nearby devices, pairs over the same transport as smartphones, and provides an interactive prompt that sends raw Unix-style commands (SPI control, sampler routing) and prints structured `ok ...`/`err ...` responses for scripting or operator use.
- Development: `cargo build`, `cargo run`, `cargo test`
- Distribution artifacts and installers may be prepared for macOS/Linux/Windows.

### IDE (`/ide`)
- Cross-platform EMWaver programmer that automates ESP-IDF setup, firmware builds/flashing, wavelet preview and syncing, and account integration without relying on a general-purpose code editor.
- Development environment and build instructions specific to the IDE tooling.
- Integrates with firmware flashing workflows and wavelet development cycle.

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
