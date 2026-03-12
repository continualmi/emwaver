# macOS Tools

This folder contains **prebuilt** helper binaries that are bundled into the macOS app.

- `emwaver-dfu-helper` — DFU flasher helper (0483:DF11)
- `emwaver-esp-helper` — ESP32-S3 serial flashing helper fallback executable

Notes:
- These binaries must be built in CI and committed/packaged so end users don't need Rust/cargo.
- They must be codesigned as part of the app bundle.
- The canonical ESP helper source now lives in `tools/emwaver-esp-helper/` and is intended to be frozen into a standalone binary for macOS and Windows.
- `macos/EMWaver/Tools/emwaver-esp-helper` remains as a local-development fallback until frozen helper binaries are produced in packaging/CI.
