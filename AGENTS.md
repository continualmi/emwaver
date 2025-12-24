# EMWaver Repository Guidelines

## Overview
- **Firmware**: ESP32-S3 firmware at repository root with modules in `main/`
- **Android**: Native Android companion app in `android/`
- **iOS**: SwiftUI companion app in `ios/`
- **Desktop App**: Cross-platform EMWaver app in `app/` (formerly `ide/`) - mirrors all mobile views/fragments
- **CLI**: Rust command-line tool in `cli/` for device interaction
- **Docs**: MkDocs-based documentation in `docs/`

## Environment Skills & Worktrees
This repo previously included local tmux helpers, but they have been removed; follow per-platform build instructions in the relevant subprojects instead (`esp/`, `stm/`, `cli/`, `docs/`, `android/`, `ios/`, `app/`).

## Project Structure & Module Organization
Firmware for the ESP32-S3 resides in `main/` and is split into modules (`ble_server.c`, `cc1101.c`, `mfrc522.c`, `badusb.c`) with matching headers. ESP-IDF managed components live in `managed_components/`; regenerate them with `idf.py reconfigure` rather than editing by hand. Companion apps sit under `android/`, `ios/`, and `app/` (desktop), while `docs/` with `mkdocs.yml` drives the user-facing site. CLI tool lives in `cli/`. Treat `build/` and generated `.elf`/`.bin` files as temporary artifacts.

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

### Firmware (Repository Root)
- Firmware lives in `main/` (modules such as `ble_server.c`, `cc1101.c`, `mfrc522.c`, `badusb.c`); regenerate ESP-IDF managed components with `idf.py reconfigure` instead of editing generated files.
- **Environment**: `source setup.sh`, then `idf.py set-target esp32s3`, `idf.py build`, `idf.py -p <port> flash`, `idf.py monitor`; keep hardware ports configurable per developer.
- **Coding style**: 4-space indent, K&R braces, `snake_case`, `static` internals, ESP-IDF headers before project headers; Python helpers follow Black defaults.
- **Command protocol**: every control packet is ASCII using Unix-style verbs and flags (e.g., `spi --open --name cc1101 --port 2 --miso 13 --mosi 11 --sck 12 --cs 10 --clock 8000000`). Current firmware supports hardware-agnostic SPI operations (`--open`, `--read`, `--write`, `--close` with `--data` hex payloads) and sampler routing (`sample --start --mode pwm --channel 3 --freq 25000 --duty 0.4`, `sample --stop`). Responses echo the same structure (`ok ...`, `err ...`) so smartphone and CLI clients stay aligned.
- **BLE services**: Custom service (UUID `45c7158e-...`) exposes command characteristic (write) and notification characteristic (read) for device control commands.
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
- Cross-platform EMWaver app that mirrors all mobile views/fragments (same UI components as Android/iOS).
- **UI Parity**: All mobile fragments/views (wavelets, IR, sampler, Git fragment, etc.) available on desktop.
- **Features**: Rich editor (syntax highlighting, linting, templates), live preview, local Git repo clone, commit/push to GitHub, full hardware interaction capabilities.
- Development environment and build instructions specific to the desktop app tooling.

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
