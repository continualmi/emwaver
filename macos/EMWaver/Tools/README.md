# macOS Tools

This folder contains **prebuilt** helper binaries that are bundled into the macOS app.

- `emwaver-dfu-helper` — DFU flasher helper (0483:DF11)
- `emwaver-esp-helper` — frozen ESP32-S3 serial flashing helper

Notes:
- These binaries must be built in CI and committed/packaged so end users don't need Rust/cargo.
- They must be codesigned as part of the app bundle.
- The canonical ESP helper source lives in `tools/emwaver-esp-helper/` and is frozen into standalone binaries for macOS and Windows packaging.
- `macos/EMWaver/Tools/emwaver-esp-helper` is the committed prebuilt macOS artifact used when a local PyInstaller build is not part of the current build environment.
