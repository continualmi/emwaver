# EMWaver Hardware Test Suite

This document tracks active manual and semi-automated validation for the current native-app architecture.

Status legend: `[x]` = passed, `[ ]` = pending. Dates are recorded only for fully passed test codes.

## Validation Model

Tests should validate the product users actually run:

```text
native app -> local JavaScript script -> USB/BLE/Wi-Fi transport -> board firmware -> hardware
```

Agent-driven tests should use named hardware primitives such as `spi_transfer`, `gpio_read`, `gpio_write`, and `analog_read`. UI panels are tested as script-defined native interfaces, not as the Agent's primary hardware access path.

## Test Code Index

| Code | Status | Systems | Passed Date | Notes |
| --- | --- | --- | --- | --- |
| `001_BLINK_LED_HOST_DEVICE_COMMS` | `[x]` | macOS | `2026-02-06` | Legacy pass; revalidate with `.js` script naming. |
| `002_CC1101_INIT_AND_REGISTER_READBACK` | `[x]` | macOS | `2026-02-07` | Legacy pass; superseded by `010`. |
| `003_SAMPLER_CAPTURE_AND_RETRANSMIT_INTEGRITY` | `[ ]` | macOS, iOS | | |
| `004_MFRC522_READ_WRITE_RFID_CARD` | `[ ]` | iOS, Android, macOS, Windows | | |
| `005_SERVO_PWM_POSITION_CONTROL` | `[ ]` | iOS, Android, macOS, Windows | | |
| `010_CC1101_JS_CROSS_PLATFORM_REGISTER_RW` | `[x]` | iOS, Android, macOS, Windows | `2026-05-24` | `cc1101.js` reads and writes all registers on tested platforms. |
| `011_AGENT_SPI_TRANSFER_CC1101_PROBE` | `[ ]` | native apps with Agent tools | | Agent uses `spi_transfer` directly to probe CC1101 registers. |
| `012_SCRIPT_DEFINED_MODULE_UI` | `[ ]` | iOS, Android, macOS, Windows | | `.js` script defines a native UI panel for a module. |
| `013_ESP32_WIFI_LAN_SCRIPT_EXECUTION` | `[ ]` | native app + ESP32-S3 | | Same-LAN Wi-Fi script execution. |
| `014_ESP32_WIFI_REMOTE_BY_IP_EXECUTION` | `[ ]` | native app + ESP32-S3 | | LAN/VPN/Tailscale-style remote-by-IP control. |
| `015_MULTI_DEVICE_NATIVE_BENCH` | `[ ]` | macOS first, then all apps | | Two simultaneous boards with isolated command/session buffers. |

## Platform Matrix

| Platform | USB | BLE | Wi-Fi | Script UI | Agent primitives | CC1101 `cc1101.js` |
| --- | --- | --- | --- | --- | --- | --- |
| iOS / iPadOS | `[x]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[x]` |
| Android | `[x]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[x]` |
| macOS | `[x]` | `[ ]` | `[ ]` | `[ ]` | `[x]` | `[x]` |
| Windows | `[x]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[x]` |
| Linux | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |

Update this matrix only with concise evidence: app build/version, board, transport, script, observed result, date, and tester.

## `001_BLINK_LED_HOST_DEVICE_COMMS`

- Script: `blink.js`
- Steps: connect a supported board over USB and run the blink script.
- Tests: native app connection, command packet path, basic script runtime execution.
- Expected: LED blinks as defined with no stalls or disconnects.

## `002_CC1101_INIT_AND_REGISTER_READBACK`

- Script: `cc1101.js`
- Steps: initialize the CC1101 and read registers.
- Tests: SPI path, CC1101 init path, register readback integrity.
- Expected: register values match the configured state and repeated init/read cycles remain stable.

## `003_SAMPLER_CAPTURE_AND_RETRANSMIT_INTEGRITY`

- Scripts: sampler and CC1101 JavaScript scripts.
- Systems: macOS and iOS first, then Android and Windows.
- Steps: initialize RX, capture a real 433 MHz signal, confirm continuous capture including idle-low or sparse regions, save/reload capture, initialize TX, retransmit.
- Tests: sampler capture integrity, export/import parity, TX replay, flow-control retransmit path.
- Expected: capture stays continuous, reload matches the original waveform, and retransmit causes the same real-world effect as the original remote.

## `004_MFRC522_READ_WRITE_RFID_CARD`

- Script target: MFRC522 JavaScript script.
- Setup: wire MFRC522/RC522 to EMWaver over SPI and place a valid RFID/NFC card near the reader.
- Steps: read card UID, select block/key, write test payload, read back the same block.
- Tests: MFRC522 SPI comms, card detect/select, auth, block write, readback verification.
- Expected: UID is read reliably and written block reads back exactly as written.

## `005_SERVO_PWM_POSITION_CONTROL`

- Script: PWM JavaScript script.
- Steps: connect servo signal to selected PWM pin, power servo from external 5V, share GND with EMWaver, run the PWM script, test min/center/max and variable positions.
- Tests: PWM servo control on real hardware, preset positions, freeform position setting.
- Expected: servo reaches distinct min/center/max positions and tracks selected positions consistently.

## `010_CC1101_JS_CROSS_PLATFORM_REGISTER_RW`

- Script: `cc1101.js`
- Systems: iOS, Android, macOS, Windows.
- Steps: connect supported hardware, run `cc1101.js`, initialize the CC1101 path, read all registers, write configurable registers, read back changed values.
- Tests: cross-platform native app script execution, USB transport, SPI register transactions, register write/readback integrity.
- Expected: every tested platform reads and writes CC1101 registers successfully.
- Current result: passed on iOS, Android, macOS, and Windows.
- Evidence to add in future: app build/version for each platform, board name, transport, CC1101 module/path, register list/hash, date, and tester.

## `011_AGENT_SPI_TRANSFER_CC1101_PROBE`

- Tool target: `spi_transfer`.
- Steps: enable Agent tools, ask the Agent to identify/probe the CC1101, run direct SPI register reads, then write/read back one safe configurable register.
- Tests: Agent direct hardware primitive access, SPI transaction correctness, error reporting, safe register write/readback.
- Expected: the Agent can probe the module without relying on UI snapshot scraping or arbitrary script eval.

## `012_SCRIPT_DEFINED_MODULE_UI`

- Script: JavaScript file using JSX-style UI syntax.
- Steps: open a module script that renders a native UI panel, use buttons/sliders/forms to trigger hardware actions, verify UI state updates after hardware responses.
- Tests: JSX-style syntax transform, native UI rendering, event callbacks, hardware calls from UI handlers, state updates.
- Expected: a single `.js` file can expose a usable native control panel for a connected module.

## `013_ESP32_WIFI_LAN_SCRIPT_EXECUTION`

- Script targets: blink, GPIO, ADC, PWM, sampler, and CC1101 JavaScript scripts as hardware allows.
- Setup: provision Wi-Fi locally over USB/BLE, keep USB available for recovery, attach representative fixtures.
- Steps: discover or manually enter the ESP32 endpoint from a native app, connect over same-LAN Wi-Fi, run scripts, verify reconnect behavior after a Wi-Fi drop, verify second-client busy handling if supported.
- Tests: same-LAN discovery/manual IP, WebSocket payload transport, single-session ownership, disconnect/reconnect diagnostics, USB/BLE recovery.
- Expected: the native app can run scripts through Wi-Fi on the LAN, recover from failures, and keep local provisioning paths available.

## `014_ESP32_WIFI_REMOTE_BY_IP_EXECUTION`

- Script targets: blink plus one representative hardware script from `013`.
- Setup: put an ESP32-S3 board on a lab/home LAN and connect the controller device through a user-owned routed path such as VPN, Tailscale, SSH tunnel, or port forwarding.
- Steps: enter the private/routed IP in the native app, run scripts, repeat with mDNS unavailable, test transient network drop/reconnect behavior.
- Tests: remote-by-IP execution, routed-network latency tolerance, manual endpoint entry, reconnect behavior.
- Expected: scripts run through the user-owned network path by IP when the board is reachable.

## `015_MULTI_DEVICE_NATIVE_BENCH`

- Setup: connect at least two EMWaver boards simultaneously, initially macOS first.
- Steps: discover both devices, connect to both, assign stable labels, run per-device commands, and run a coordinated test where one board generates/transmits and another observes/samples.
- Tests: multi-device discovery, stable selection, concurrent transport ownership, command routing by device, per-device script/session isolation.
- Expected: the native app can control a small hardware bench without cross-device buffer leakage or stale session state.
