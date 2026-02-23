# EMWaver Current Hardware Test Suite

This document tracks only the active manual tests.

Status legend: `[x]` = passed, `[ ]` = pending. Dates are recorded only for fully passed test codes.

## Test Code Index

| Code | Status | Systems | Passed Date |
| --- | --- | --- | --- |
| `001_BLINK_LED_HOST_DEVICE_COMMS` | `[x]` | macOS | `2026-02-06` |
| `002_CC1101_INIT_AND_REGISTER_READBACK` | `[x]` | macOS | `2026-02-07` |
| `003_SAMPLER_CAPTURE_AND_RETRANSMIT_INTEGRITY` | `[x]` | macOS | `2026-02-07` |
| `004_SERVO_PWM_POSITION_CONTROL` | `[ ]` |  | |
| `007_SECURE_DEVICE_CONNECTION` | `[ ]` | macOS, Windows, Android | |
| `008_SECURE_DEVICE_FIRMWARE_UPDATE_GATING` | `[ ]` | macOS, Windows, Android | |
| `009_DEVICE_IDENTITY_RECOVERY_REPROVISION` | `[ ]` | macOS, Windows, Android | |

## Remote Case Matrix

- Letter map: `M`=macOS, `W`=Windows, `I`=iOS, `A`=Android, `F`=Frontend web controller, `L`=Linux headless host.
- Controller -> host cases used by all remote variants: `MW`, `MI`, `MA`, `ML`, `WM`, `WI`, `WA`, `WL`, `IM`, `IW`, `IA`, `IL`, `AM`, `AW`, `AI`, `AL`, `FM`, `FW`, `FI`, `FA`, `FL`.
- Rule: frontend is controller-only (never host).
- Rule: Linux is host-only (never controller).

| Case | Controller | Host | `001R` | `002R` | `003R` | `004R` |
| --- | --- | --- | --- | --- | --- | --- |
| `MW` | macOS | Windows | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `MI` | macOS | iOS | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `MA` | macOS | Android | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `WM` | Windows | macOS | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `WI` | Windows | iOS | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `WA` | Windows | Android | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `IM` | iOS | macOS | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `IW` | iOS | Windows | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `IA` | iOS | Android | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `AM` | Android | macOS | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `AW` | Android | Windows | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `AI` | Android | iOS | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `FM` | Frontend | macOS | `[x]` | `[x]` | `[x]` | `[ ]` |
| `FW` | Frontend | Windows | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `FI` | Frontend | iOS | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `FA` | Frontend | Android | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `ML` | macOS | Linux | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `WL` | Windows | Linux | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `IL` | iOS | Linux | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `AL` | Android | Linux | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| `FL` | Frontend | Linux | `[ ]` | `[ ]` | `[ ]` | `[ ]` |

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

- Scripts: `cc1101.emw` + `ism.emw`
- Steps: in `cc1101.emw` press `initRx` or `initTx`; in `ism.emw` press `Initialize` and read all registers.
- Tests: SPI path, CC1101 init path, register write/readback integrity.
- Expected: `115000` baud, `433.92 MHz`, `ASK/OOK`, and no repeated-init garbage.

### Remote (`002R_REMOTE_CC1101_INIT_AND_REGISTER_READBACK`)

- Steps: run the same CC1101 init/readback flow through remote host control across the full remote case matrix.
- Expected: matches local `002` in all cases.

## `003_SAMPLER_CAPTURE_AND_RETRANSMIT_INTEGRITY`

### Local

- Scripts: `sampler.emw` + `cc1101.emw`
- Steps: in `cc1101.emw` press `initRx`; capture a real 433 MHz signal in `sampler.emw`; confirm chart capture is continuous; switch to `initTx`; press `Retransmit`.
- Tests: sampler capture integrity, uninterrupted recording, TX replay, flow-control retransmit path.
- Expected: retransmit causes same real-world effect as original remote; optional RTL-SDR check within about 5-10 us pulse-width margin for current sampler resolution.

### Remote (`003R_REMOTE_SAMPLER_CAPTURE_AND_RETRANSMIT_INTEGRITY`)

- Steps: run the same sampler capture/retransmit flow through remote host control across the full remote case matrix.
- Expected: matches local `003` in all cases.

## `004_SERVO_PWM_POSITION_CONTROL`

### Local

- Script: `pwm.emw`
- Steps: connect servo signal to selected PWM pin, power servo from external 5V, share GND with EMWaver; run `pwm.emw`; test `Min`, `Center`, `Max`, then slider + `Move Slider Position`.
- Tests: PWM servo control on real hardware, preset positions, freeform position setting.
- Expected: servo reaches distinct Min/Center/Max positions and tracks slider-selected positions consistently.

### Remote (`004R_REMOTE_SERVO_PWM_POSITION_CONTROL`)

- Steps: run the same servo PWM flow through remote host control across the full remote case matrix.
- Expected: matches local `004` in all cases.

## `007_SECURE_DEVICE_CONNECTION`

### Local

- Systems: macOS, Windows, Android.
- Purpose: verify SecureWaver-minted devices connect as **secure**, and non-minted devices are rejected.

Steps:

1) Use **SecureWaver** to provision a device identity (DeviceID + Proof) onto a device.
2) In the EMWaver app, connect that device.
   - Expected: app performs identity read (`EMW_OP_IDENTITY_GET`) and verifies `Proof` against the embedded Root public key.
   - Expected: app shows a **secure connected** badge/glyph.
3) Connect an **unsecured** device (no DeviceID/Proof provisioned; or identity page erased).
   - Expected: app rejects device (no secure badge; connection blocked or marked non-genuine).

## `008_SECURE_DEVICE_FIRMWARE_UPDATE_GATING`

### Local

- Systems: macOS, Windows, Android.
- Purpose: firmware updates are only offered/performed for **secured** devices.

Steps:

1) Use **SecureWaver** to provision a device identity (DeviceID + Proof) onto a device.
2) In the EMWaver app, open firmware update.
   - Expected: app checks device identity first.
   - Expected: app offers and performs update for secured device.
3) Connect an **unsecured** device (no DeviceID/Proof).
   - Expected: firmware update is **not offered** (or is blocked with an explicit message).

## `009_DEVICE_IDENTITY_RECOVERY_REPROVISION`

### Local

- Systems: macOS, Windows, Android.
- Purpose: allow a legitimate owner to recover a device identity (DeviceID + Proof) from the backend when identity is missing/invalid, then retry the firmware update successfully.

Steps:

1) Sign into the EMWaver app.
2) App checks backend that the account has an eligible **EMWaver purchase** / entitlement.
3) Connect a device in a "needs recovery" state (missing/invalid identity page).
4) Open the firmware update modal.
   - Expected: app detects missing/invalid identity and offers **Recover device**.
5) User triggers recovery.
   - Expected: app requests a new `(DeviceID, Proof)` from backend for this account/device.
   - Expected: app flashes **only the identity page** (DeviceID+Proof) onto the device.
6) App prompts user to retry firmware update.
   - Expected: update now proceeds normally (device passes identity verification).
