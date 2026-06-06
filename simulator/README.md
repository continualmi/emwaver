# EMWaver Simulator Fixtures

This folder stores shared mock-device scenarios for platform tests.

The fixture files are intended to be the cross-platform source of truth for deterministic EMWaver device behavior. Platform-specific test adapters should read these fixtures directly, or consume generated equivalents from the same data.

## Fixture Fields

- `board`: board type, display name, firmware version, hardware UID, and supported protocol version.
- `gpio`: pin capabilities and initial digital levels.
- `adc`: deterministic ADC values for pins and internal sources.
- `pwm`: PWM-capable pins and default frequency.
- `serial`: UART stub read bytes.
- `i2c`: default read byte and optional address-specific replies.
- `spi`: default read byte and optional transfer replies.

Fixtures are not a replacement for real hardware tests. They exist so script runtimes, UI code, and MCP/tool-facing script checks can run in CI without a physical board.

Virtual MIDI/USB transport is intentionally not the default simulator layer. See `VIRTUAL_TRANSPORT.md` for the OS support and CI feasibility decision.
