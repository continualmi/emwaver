# EMWaver ESP Helper

Freeze-friendly Python source for the ESP32 serial flashing helper used by desktop apps.

Current contract:
- `list-ports`
- `chip-id --port ... [--chip auto|esp32|esp32s3] [--baud ...] [--no-stub]`
- `read-identity --port ... [--baud ...]`
- `flash --chip esp32|esp32s3 --port ... --bootloader-offset ... --flash-freq ... --bootloader ... --partition-table ... --ota-data ... --app ... [--baud ...] [--before ...] [--after ...] [--no-stub]`

The flash command defaults to the same fast path ESP-IDF uses for normal
`idf.py flash`: 460800 baud, `default_reset`, hard reset after flashing, and
the esptool RAM stub enabled. Use `--no-stub` only as a recovery fallback.

Build a standalone helper with:

```bash
python3 -m pip install -r tools/emwaver-esp-helper/requirements-freeze.txt
python3 tools/emwaver-esp-helper/build_helper.py
```

Expected output:
- macOS/Linux: `tools/emwaver-esp-helper/dist/emwaver-esp-helper`
- Windows: `tools/emwaver-esp-helper/dist/emwaver-esp-helper.exe`

The generated `build/` and `dist/` folders are local artifacts and should stay out of git.
