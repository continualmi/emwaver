---
name: wavelet-authoring
description: Turn a proven vibe-hacking command recipe into a Wavelet UI that emits the same ASCII commands and renders raw hex/ascii responses. Use after you can reliably read/write registers via the CLI.
---

# Wavelet Authoring

Turn a proven command recipe into a Wavelet UI that sends the same ASCII commands and renders responses.

## Preconditions
- You already have a working command recipe (e.g. from `.emwaver/SPI.md`).
- The commands fit inside the 64-byte packet limit (or are chunked appropriately).

## Procedure
1. Start from the smallest useful UI:
   - “Read register” input + button
   - response bytes shown as both hex + ASCII
2. Implement the Wavelet to emit the exact validated ASCII command strings.
3. Add convenience buttons for common registers (e.g. `STATUS`, `CONFIG`, `VERSION`).
4. Keep a “debug pane” that logs:
   - command sent
   - raw response bytes
   - parsed fields (optional)
5. Document the Wavelet’s mapping back to the underlying commands in `.emwaver/WAVELETS.md`.

