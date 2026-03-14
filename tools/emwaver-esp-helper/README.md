# EMWaver ESP Helper

Freeze-friendly Python source for the ESP32-S3 serial flashing helper used by desktop apps.

Current contract:
- `list-ports`
- `chip-id --port ... [--baud ...] [--no-stub]`
- `read-identity --port ... [--baud ...]`
- `flash --port ... --bootloader ... --partition-table ... --ota-data ... --app ... [--baud ...] [--before ...] [--after ...] [--no-stub]`

Build a standalone helper with:

```bash
python3 -m pip install -r tools/emwaver-esp-helper/requirements-freeze.txt
python3 tools/emwaver-esp-helper/build_helper.py
```

Expected output:
- macOS/Linux: `tools/emwaver-esp-helper/dist/emwaver-esp-helper`
- Windows: `tools/emwaver-esp-helper/dist/emwaver-esp-helper.exe`

The generated `build/` and `dist/` folders are local artifacts and should stay out of git.
