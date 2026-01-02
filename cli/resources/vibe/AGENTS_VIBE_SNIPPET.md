<!-- EMWAVER_VIBE_HACKING_START -->
## Vibe Hacking

Vibe hacking means: quickly probing and controlling connected modules (SPI/I2C/GPIO/radios) using the EMWaver ASCII command protocol, then turning successful probes into repeatable recipes and Wavelet UIs.

Repo-local docs live under `.emwaver/` (Markdown-only).

**Golden rules**
- Commands are ASCII and must fit in the device’s 64-byte packet; prefer `--key=value` to keep commands short.
- For raw interaction, use `emwaver cmd --verbose "<command>"` to see both hex and ASCII.

**SPI quickstart (examples)**
- CC1101 `VERSION` register (expects `0x14`):
  - `spi open --name=c --miso=13 --mosi=11 --sck=12 --cs=10`
  - `spi xfer --name=c --tx=0xF1,0x00 --rx=2`  (byte0=status, byte1=version)
- NRF24L01(+) sanity register reads on CS=14:
  - `spi open --name=n --miso=13 --mosi=11 --sck=12 --cs=14`
  - `spi xfer --name=n --tx=0x00,0x00 --rx=2`  (`CONFIG` reset default often `0x08`)

See `.emwaver/SPI.md` for more.
<!-- EMWAVER_VIBE_HACKING_END -->
