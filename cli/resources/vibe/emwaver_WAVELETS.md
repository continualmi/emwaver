---
title: Wavelets (Vibe Hacking → UI)
type: guide
---

# Wavelets (Vibe Hacking → UI)

Once you’ve proven a module interaction with raw commands (e.g. `spi xfer` reads the expected registers), the next step is to package it into a Wavelet so it’s repeatable and has a real UI.

## Suggested workflow

1. Capture a minimal “bring-up recipe” in `.emwaver/SPI.md` (or a module-specific markdown).
2. Decide on a simple UI:
   - register read/write panel
   - live status indicator (e.g. `STATUS` register)
   - preset buttons (init/configure/scan)
3. Implement a Wavelet that emits the same ASCII commands you validated.

## Practical tips

- Keep Wavelet logic transport-agnostic: it should only construct the same ASCII commands the CLI uses.
- Prefer short command strings (`--key=value`) to avoid 64-byte packet truncation.
- Add a “raw log” view that displays both the command sent and the `hex:` response bytes.
