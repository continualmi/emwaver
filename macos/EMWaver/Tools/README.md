# macOS Tools

This folder contains helper binaries/resources used by the macOS app.

- `emwaver-dfu-helper` — DFU flasher helper (0483:DF11)

Notes:
- Generated ESP helper bundles should not be committed from local development.
- They must be codesigned as part of the app bundle.
- The canonical ESP helper source lives in `tools/emwaver-esp-helper/`.
- Release packaging can decide how to bundle the ESP helper later; local build output should stay out of git.
