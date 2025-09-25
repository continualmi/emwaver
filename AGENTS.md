# Repository Guidelines

## Project Structure & Module Organization
Firmware for the ESP32-S3 resides in `main/` and is split into modules (`ble_server.c`, `cc1101.c`, `mfrc522.c`, BadUSB) with matching headers. ESP-IDF managed components live in `managed_components/`; regenerate them with `idf.py reconfigure` rather than editing by hand. Companion apps sit under `android/` and `ios/`, while `docs/` with `mkdocs.yml` drives the user-facing site. Treat `build/` and generated `.elf`/`.bin` files as temporary artifacts.

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

## Coding Style & Naming Conventions
Use 4-space indentation, K&R braces, and `snake_case` names for functions, FreeRTOS tasks, and globals. Place ESP-IDF headers before project headers, keep module constants near their use, and mark internals `static`. Expose only clean APIs in headers and document timing-critical code paths with brief comments. Python helper scripts follow Black defaults (88-character lines, lowercase names).

## Testing Guidelines
Start with `idf.py flash monitor` to confirm logging and peripheral behaviour on hardware. Automated smoke tests live in `pytest_hello_world.py`; extend them with `test_<feature>` functions tagged `@pytest.mark.host_test` (add target markers when needed) and run via `pytest -m host_test`. Record edge cases such as buffer rollover or semaphore exhaustion before submitting a PR.

## Commit & Pull Request Guidelines
Write imperative, scoped commit subjects (`driver: fix cc1101 init`) and keep unrelated changes in separate commits. Pull requests must describe the hardware scenario, list commands or tests executed, and link to issues or documentation updates. Attach serial logs or screenshots when behaviour changes, and flag any `sdkconfig` edits for review.

## Security & Configuration Notes
Never commit credentials, BLE pairing keys, or Wi-Fi secrets; use Kconfig defaults or NVS at runtime. Mirror intentional configuration changes in `sdkconfig.ci` and document new persistent layouts in `docs/` so downstream tooling stays aligned.
