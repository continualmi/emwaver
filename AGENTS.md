# Repository Guidelines

## Project Structure & Module Organization
Firmware for the ESP32-S3 resides in `main/` and is split into modules (`ble_server.c`, `cc1101.c`, `mfrc522.c`, BadUSB) with matching headers. ESP-IDF managed components live in `managed_components/`; regenerate them with `idf.py reconfigure` rather than editing by hand. Companion apps sit under `android/` and `ios/`, while `docs/` with `mkdocs.yml` drives the user-facing site. Treat `build/` and generated `.elf`/`.bin` files as temporary artifacts.

## Wavelet Feature
Wavelets are the user-authored extension bundles (manifest + JavaScript) that plug into the Wavelet Engine sandbox to broaden EMWaver beyond the built-in fragments. They combine UI declarations with scripted logic that talks to firmware through the EMWaver Script SDK. Refer to `TODO.md` for the evolving roadmap, packaging details, and open questions.

- **Parity-first UI DSL**: treat the Wavelet UI description language as a thin translation layer over our native SwiftUI/Compose capabilities. Aim for feature parity with existing Swift views, while keeping the DSL portable so Android renders the same layout from the same script. Any new component should be exposed in a way that both platforms can implement consistently.
- **Unified scripting engine**: WaveletEngine is the single runtime for both interactive UI wavelets and CLI-style scripts. All native bridges (CC1101, BLE, Utils, IR) must be injected here so scripts do not depend on the deprecated ScriptsEngine.
- **In-wavelet logging**: scripts surface their output through Wavelet UI components (e.g., `UI.logViewer`) instead of the legacy console text pane. Avoid adding new out-of-band logging surfaces.

## Environment Setup
Load the ESP-IDF toolchain by running `source setup.sh` (never `bash setup.sh`) so the preconfigured export script is applied. Create a virtual environment and install Python tooling with `python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`.

## Build, Test, and Development Commands
```bash
idf.py set-target esp32s3
idf.py build
idf.py -p /dev/ttyACM0 flash
idf.py monitor
pytest -m host_test
```
Replace the serial device as appropriate for your platform. Use `idf.py clean` only when caches become inconsistent.

> **Agent Note:** Do not run `xcodebuild` (or other iOS build commands) from the CLI; leave iOS builds to be run manually in Xcode by the user.

## Coding Style & Naming Conventions
Use 4-space indentation, K&R braces, and `snake_case` names for functions, FreeRTOS tasks, and globals. Place ESP-IDF headers before project headers, keep module constants near their use, and mark internals `static`. Expose only clean APIs in headers and document timing-critical code paths with brief comments. Python helper scripts follow Black defaults (88-character lines, lowercase names).

## Testing Guidelines
Start with `idf.py flash monitor` to confirm logging and peripheral behaviour on hardware. Automated smoke tests live in `pytest_hello_world.py`; extend them with `test_<feature>` functions tagged `@pytest.mark.host_test` (add target markers when needed) and run via `pytest -m host_test`. Record edge cases such as buffer rollover or semaphore exhaustion before submitting a PR.

## Commit & Pull Request Guidelines
Write imperative, scoped commit subjects (`driver: fix cc1101 init`) and keep unrelated changes in separate commits. Pull requests must describe the hardware scenario, list commands or tests executed, and link to issues or documentation updates. Attach serial logs or screenshots when behaviour changes, and flag any `sdkconfig` edits for review.

## Security & Configuration Notes
Never commit credentials, BLE pairing keys, or Wi-Fi secrets; use Kconfig defaults or NVS at runtime. Mirror intentional configuration changes in `sdkconfig.ci` and document new persistent layouts in `docs/` so downstream tooling stays aligned.

## Continuous Backend Single Sign-On
- The `continuous-mattermost` fork (cloned under `/Users/luispl/continuous-mattermost`) runs the Continuous Society platform using Mattermost’s authentication stack.
- Azure PostgreSQL flexible server `continuousocietysql` stores all Mattermost user accounts; Microsoft Entra ID (Azure AD) is enabled alongside password auth, with firewall rules granting access to the AKS cluster and developer IPs.
- The AKS cluster `continuousocietycluster` (UK South) hosts the customized Mattermost deployment; once started it exposes the same API and database as the web UI.
- All clients—web, desktop, and smartphone apps—should point to this server so accounts are shared across platforms. Native mobile SSO (OpenID/Office365/Entra) can be enabled by registering the mobile redirect URIs in Azure and updating `config.json`.
- Deployment flow: GitHub Actions builds the Docker image and pushes to GHCR; manual `az webapp config container set` commands update the Free-tier Azure Web App (`emwaver-backend`) using the image tag and GHCR PAT (`GHCR_PAT`).
- Whenever login requirements change (e.g., enforcing Entra-only auth, rotating secrets), update the Mattermost config stored in Kubernetes/`config.json` and ensure the mobile apps follow the same SSO endpoints.
