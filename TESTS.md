# EMWaver Current Hardware Test Suite

This document tracks only the active manual tests.

Status legend: `[x]` = passed, `[ ]` = pending. Dates are recorded only for fully passed test codes.

## Test Code Index

| Code | Status | Systems | Passed Date |
| --- | --- | --- | --- |
| `001_BLINK_LED_HOST_DEVICE_COMMS` | `[x]` | macOS | `2026-02-06` |
| `002_CC1101_INIT_AND_REGISTER_READBACK` | `[x]` | macOS | `2026-02-07` |
| `003_SAMPLER_CAPTURE_AND_RETRANSMIT_INTEGRITY` | `[ ]` | macOS, iOS | |
| `004_MFRC522_READ_WRITE_RFID_CARD` | `[ ]` |  | |
| `005_SERVO_PWM_POSITION_CONTROL` | `[ ]` |  | |

## Remote Case Matrix

- Letter map: `M`=macOS, `W`=Windows, `I`=iOS, `A`=Android, `F`=Frontend web controller, `L`=Linux headless host.
- Controller -> host cases used by all remote variants: `MW`, `MI`, `MA`, `ML`, `WM`, `WI`, `WA`, `WL`, `IM`, `IW`, `IA`, `IL`, `AM`, `AW`, `AI`, `AL`, `FM`, `FW`, `FI`, `FA`, `FL`.
- Rule: frontend is controller-only (never host).
- Rule: Linux is host-only (never controller).

| Case | Controller | Host | `001R` | `002R` | `003R` | `004R` | `005R` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `MW` | macOS | Windows | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `MI` | macOS | iOS | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `MA` | macOS | Android | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `WM` | Windows | macOS | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `WI` | Windows | iOS | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `WA` | Windows | Android | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `IM` | iOS | macOS | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `IW` | iOS | Windows | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `IA` | iOS | Android | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `AM` | Android | macOS | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `AW` | Android | Windows | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `AI` | Android | iOS | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `FM` | Frontend | macOS | `[x]` | `[x]` | `[x]` | `[ ]` | `[ ]` |
| `FW` | Frontend | Windows | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `FI` | Frontend | iOS | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `FA` | Frontend | Android | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `ML` | macOS | Linux | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `WL` | Windows | Linux | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `IL` | iOS | Linux | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `AL` | Android | Linux | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `FL` | Frontend | Linux | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |

## `001_BLINK_LED_HOST_DEVICE_COMMS`

### Local

- Script: `blink.emw`
- Steps: connect board over USB and run `blink.emw`.
- Tests: host-device comms and basic script runtime execution.
- Expected: LED blinks as defined, with no stalls/failures.

### Remote (`001R_REMOTE_BLINK_LED_HOST_CONTROLLER_COMMS`)

- Steps: run the same blink flow through remote host control across the full remote case matrix.
- Expected: matches local `001` in all cases.

## `002_CC1101_INIT_AND_REGISTER_READBACK`

### Local

- Script: `cc1101.emw`
- Steps: in `cc1101.emw` press `Init RX` or `Init TX`, then `Initialize & Read` to read all registers.
- Tests: SPI path, CC1101 init path, register write/readback integrity.
- Expected: `115000` baud, `433.92 MHz`, `ASK/OOK`, and no repeated-init garbage.

### Remote (`002R_REMOTE_CC1101_INIT_AND_REGISTER_READBACK`)

- Steps: run the same CC1101 init/readback flow through remote host control across the full remote case matrix.
- Expected: matches local `002` in all cases.

## `003_SAMPLER_CAPTURE_AND_RETRANSMIT_INTEGRITY`

### Local

- Scripts: `sampler.emw` + `cc1101.emw`
- Systems: macOS, iOS
- Steps: in `cc1101.emw` press `initRx`; capture a real 433 MHz signal in `sampler.emw`; confirm chart capture is continuous, including idle-low or sparse regions; save `.raw`; clear and reload; save timings `.txt`; switch to `initTx`; press `Retransmit`.
- Tests: sampler capture integrity, uninterrupted recording, all-zero lane continuity, `.raw` reload parity, timings export/import parity, TX replay, flow-control retransmit path.
- Expected: chart keeps advancing during active sampling even when the signal is idle-low; reloaded captures match the original waveform; retransmit causes same real-world effect as original remote; optional RTL-SDR check within about 5-10 us pulse-width margin for current sampler resolution.

### Remote (`003R_REMOTE_SAMPLER_CAPTURE_AND_RETRANSMIT_INTEGRITY`)

- Steps: run the same sampler capture/retransmit flow through remote host control across the full remote case matrix, including iOS host cases where supported.
- Expected: matches local `003` in all cases.

## `004_MFRC522_READ_WRITE_RFID_CARD`

### Local

- Script target: `mfrc522_read_write.emw`
- Setup: wire MFRC522 (RC522) to EMWaver over SPI and place a valid RFID/NFC card near reader.
- Steps: run the script; read card UID; select block + key; write test payload; read back same block and verify exact match.
- Tests: MFRC522 SPI comms, card detect/select, auth, block write, readback verification.
- Expected: UID is read reliably and written block reads back exactly as written.

### Remote (`004R_REMOTE_MFRC522_READ_WRITE_RFID_CARD`)

- Steps: run the same MFRC522 read/write/verify flow through remote host control across the full remote case matrix.
- Expected: matches local `004` in all cases.

## `005_SERVO_PWM_POSITION_CONTROL`

### Local

- Script: `pwm.emw`
- Steps: connect servo signal to selected PWM pin, power servo from external 5V, share GND with EMWaver; run `pwm.emw`; test `Min`, `Center`, `Max`, then slider + `Move Slider Position`.
- Tests: PWM servo control on real hardware, preset positions, freeform position setting.
- Expected: servo reaches distinct Min/Center/Max positions and tracks slider-selected positions consistently.

### Remote (`005R_REMOTE_SERVO_PWM_POSITION_CONTROL`)

- Steps: run the same servo PWM flow through remote host control across the full remote case matrix.
- Expected: matches local `005` in all cases.
