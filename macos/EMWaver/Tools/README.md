# macOS Tools

This folder contains **prebuilt** helper binaries that are bundled into the macOS app.

- `emwaver-dfu-helper` — DFU flasher helper (0483:DF11)

Notes:
- These binaries must be built in CI and committed/packaged so end users don't need Rust/cargo.
- They must be codesigned as part of the app bundle.
