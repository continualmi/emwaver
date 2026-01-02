---
name: vibe-hacking
description: Probe new modules quickly using EMWaver CLI ASCII commands (spi open/xfer), validate with known-good register reads, and record repeatable recipes. Use when bringing up a new SPI module or debugging command/packet issues.
---

# Vibe Hacking

Probe new modules quickly using EMWaver CLI ASCII commands, validate with known-good register reads, and record repeatable recipes.

## Inputs
- Module name (e.g. `cc1101`, `nrf24l01+`)
- Pin map (MISO/MOSI/SCK/CS + mode/clock if known)
- Expected “fixed” register values (reset defaults or silicon IDs)

## Procedure
1. Connect to device:
   - `emwaver daemon start`
   - `emwaver daemon connect`
2. Open SPI (keep command under 64 bytes; use `--key=value`):
   - `emwaver cmd --verbose "spi open --name=x --miso=13 --mosi=11 --sck=12 --cs=<pin>"`
3. Read a known register via `spi xfer`:
   - Most reads need `--tx=<cmd>,0x00 --rx=2` (status + data).
4. Validate:
   - If values match expected defaults/IDs, proceed to richer interactions.
   - If values are `0xFF`/`0x00` everywhere, suspect wiring, CS, mode, power, or bus contention.
5. Record the recipe:
   - Update `.emwaver/SPI.md` with the exact commands and expected results.
6. Convert to UI:
   - Add a Wavelet that emits the same ASCII commands (see `.emwaver/WAVELETS.md`).
