# Platform Feature Parity

This directory owns the cross-platform parity contract for EMWaver native apps.
The contract is intentionally component-based so it can grow without turning the
verifier into a single hardcoded test.

Run the suite locally:

```bash
node scripts/parity/verify-platform-parity.mjs
```

This suite is currently run manually when changing platform parity contracts.

## Structure

- `features/mcp.json` - desktop MCP bridge contract and mobile MCP exceptions.
- `features/transport.json` - USB MIDI and BLE runtime transport parity.
- `features/scripting.json` - script asset and simulator-test parity.
- `features/firmware.json` - STM32 DFU and ESP32-S3 serial update parity.
- `features/local-first.json` - local-first policy and forbidden hosted account gates.
- `../../scripts/parity/verify-platform-parity.mjs` - the generic runner.

## Status Model

Every feature must list all native app platforms: `macos`, `ios`, `windows`,
and `android`.

- `required` means the platform must have evidence that the feature exists.
- `optional`, `planned`, and `not_applicable` are allowed only with a reason.
- `parity: "all_required"` fails if any platform is not `required`.
- `parity: "documented_exceptions"` allows intentional differences, but they
  must be explicit and documented in the platform entry.

This is a static contract test. It does not replace platform unit/UI tests.
Its job is to catch drift early: when one platform gains, loses, renames, or
removes a capability, the manifest must either keep every platform aligned or
record a deliberate exception.
