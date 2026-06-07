# EMWaver ESP Helper

Freeze-friendly Python source for the ESP serial flashing helper used by desktop apps.

Current contract:
- `list-ports`
- `chip-id --port ... [--chip auto|esp8266|esp32|esp32s2|esp32s3] [--baud ...] [--no-stub]`
- `read-identity --port ... [--baud ...]`
- `flash --chip esp8266|esp32|esp32s2|esp32s3 --port ... --bootloader-offset ... --partition-table-offset ... --app-offset ... --flash-freq ... --flash-size ... --bootloader ... --partition-table ... [--ota-data ...] --app ... [--baud ...] [--before ...] [--after ...] [--no-stub]`

The flash command defaults to the same fast path ESP-IDF uses for normal
`idf.py flash`: 460800 baud, `default-reset`, hard reset after flashing, and
the esptool RAM stub enabled. Use `--before no-reset` when the board is already
manually held in the ROM bootloader. Use `--no-stub` only as a recovery fallback.

Build a standalone helper with:

```bash
python3 -m pip install -r tools/emwaver-esp-helper/requirements-freeze.txt
python3 tools/emwaver-esp-helper/build_helper.py
```

Expected output:
- macOS/Linux: `tools/emwaver-esp-helper/dist/emwaver-esp-helper`
- Windows: `tools/emwaver-esp-helper/dist/emwaver-esp-helper.exe`

The generated `build/` and `dist/` folders are local artifacts and should stay out of git.
