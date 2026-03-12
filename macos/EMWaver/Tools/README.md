# macOS Tools

This folder contains **prebuilt** helper binaries that are bundled into the macOS app.

- `emwaver-dfu-helper` — DFU flasher helper (0483:DF11)
- `emwaver-esp-helper` — ESP32-S3 serial flashing helper wrapper

Notes:
- These binaries must be built in CI and committed/packaged so end users don't need Rust/cargo.
- They must be codesigned as part of the app bundle.
- The current ESP helper is a lightweight wrapper around `python -m esptool`; long term the app should ship a self-contained helper/runtime instead of assuming a system Python environment.
