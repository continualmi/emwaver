# EMWaver Hardware Test Suite

This document tracks only the active manual tests.

Status legend: `[x]` = passed, `[ ]` = pending. Dates are recorded only for fully passed test codes.

## Automation Bench Goal

The hardware test suite should move toward an agent-driven local automation bench: one machine running the `emw`/`emwaver` CLI and localhost Gateway, connected to multiple EMWaver boards and modules. The target bench is at least two simultaneous devices: two ESP32-S3 BLE boards, or one ESP32-S3 BLE board plus one USB MIDI STM32 board. With that box, a coding agent should be able to create local custom `.emw` scripts, run them, inspect `ui.snapshot` output/logs, send `ui.event` interactions, stop/reset scripts, and validate hardware loops such as CC1101, sampler/retransmit, RFID, PWM, GPIO, ADC, SPI, I2C, and UART with minimal manual intervention.

## Test Code Index

| Code | Status | Systems | Passed Date |
| --- | --- | --- | --- |
| `001_BLINK_LED_HOST_DEVICE_COMMS` | `[x]` | macOS | `2026-02-06` |
| `002_CC1101_INIT_AND_REGISTER_READBACK` | `[x]` | macOS | `2026-02-07` |
| `003_SAMPLER_CAPTURE_AND_RETRANSMIT_INTEGRITY` | `[ ]` | macOS, iOS | |
| `004_MFRC522_READ_WRITE_RFID_CARD` | `[ ]` |  | |
| `005_SERVO_PWM_POSITION_CONTROL` | `[ ]` |  | |
| `006_AGENT_CLI_GATEWAY_SCRIPT_LOOP` | `[ ]` | macOS, Linux | |
| `007_MULTI_DEVICE_AGENT_BENCH` | `[ ]` | macOS, Linux | |
| `008_ESP32_WIFI_LAN_SCRIPT_EXECUTION` | `[ ]` | macOS, Linux, ESP32-S3 | |
| `009_ESP32_WIFI_VPN_BY_IP_EXECUTION` | `[ ]` | macOS, Linux, ESP32-S3 | |

## Remote Case Matrix

- Letter map: `M`=macOS, `W`=Windows, `I`=iOS, `A`=Android, `F`=Gateway browser UI, `L`=Linux headless Gateway host.
- Remote variants cover user-owned network paths only. Native apps are self-contained local surfaces; terminal/browser workflows use Gateway.

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

## `006_AGENT_CLI_GATEWAY_SCRIPT_LOOP`

### Local

- Script target: custom `.emw` file created outside `assets/default-scripts`.
- Setup: run localhost Gateway against a real board.
- Steps: from the terminal/agent, create or edit a local `.emw` script; run it with `emwaver run`; wait for `script.started`; capture the latest `ui.snapshot`; send at least one `ui.event`; verify a changed snapshot or hardware effect; stop the script; confirm no stale active script remains.
- Tests: terminal-first agent workflow, Gateway execution, custom local script loading, UI snapshot inspection, UI event dispatch, stop/reset behavior, and hardware command execution.
- Expected: the agent can iterate on a custom script without using the app UI manually, and the hardware ends in a known safe state after stop/reset.

## `007_MULTI_DEVICE_AGENT_BENCH`

### Local

- Script target: multi-device diagnostic `.emw` scripts or equivalent CLI-driven test scripts.
- Setup: connect at least two EMWaver boards simultaneously, initially either two ESP32-S3 BLE devices or one ESP32-S3 BLE device plus one USB MIDI STM32 device. Attach representative modules such as CC1101, RFID, PWM servo, ADC/GPIO loopback, I2C, SPI, or UART fixtures.
- Steps: discover both devices; connect to both at the same time; assign stable names/ids; run per-device commands; run a coordinated test where one board generates or transmits and another board observes or samples; collect snapshots/logs/status for each device; stop/reset both devices.
- Tests: multi-device discovery, stable selection, concurrent BLE/USB ownership, command routing by device, per-device UI/status attribution, and agent-driven validation of hardware loops across boards.
- Expected: one local agent session can control the bench as a hardware validation box and repeatedly probe EMWaver capabilities without manual reconnect/reconfigure steps.

## `008_ESP32_WIFI_LAN_SCRIPT_EXECUTION`

### Local

- Script targets: `assets/default-scripts/blink.emw`, `assets/default-scripts/gpio.emw`, `assets/default-scripts/adc.emw`, `assets/default-scripts/pwm.emw`, `assets/default-scripts/sampler.emw`, and `assets/default-scripts/cc1101.emw`.
- Setup: flash the current ESP32-S3 firmware payload; provision Wi-Fi with SSID/password only over USB or BLE; keep USB available for recovery; attach LED, ADC/GPIO loopback, PWM/servo, CC1101 SPI, and sampler/retransmit fixtures as available.
- Steps: discover the board through `_emwaver._tcp`; run `emwaver devices`; start `emwaver gateway serve --wifi <mdns-host>`; run `emwaver run assets/default-scripts/blink.emw`; repeat by direct IP; verify the macOS native app manual connect/discovery path; connect multiple same-LAN ESP32 boards on port `3922`; attempt a second simultaneous client and confirm `busy`; drop Wi-Fi during a running script; clear/reprovision Wi-Fi over USB or BLE.
- Tests: same-LAN mDNS discovery, same-LAN manual IP, LAN-trust WebSocket command transport, per-endpoint single-session ownership, multiple same-LAN board selection, disconnect reporting/recovery, and USB/BLE recovery after bad Wi-Fi configuration.
- Expected: CLI and macOS app can run scripts through Wi-Fi without accounts, cloud relay, hosted activation, or extra transport credentials; second simultaneous clients are rejected as busy; Wi-Fi drops leave the runtime recoverable; USB/BLE provisioning remains available.
- Evidence to record before marking passed: ESP32-S3 board model, firmware commit/hash or bundle version, provisioning transport used, SSID/network shape, mDNS hostname, direct IP, exact CLI commands and exit results, macOS app version/build, observed script behavior for each hardware fixture, second-client busy result, Wi-Fi drop/reconnect result, USB/BLE recovery result, date, and tester.

### Hardware Coverage

- GPIO blink visibly matches script timing.
- ADC read returns plausible values from the test fixture.
- SPI module readback matches the expected CC1101 register state.
- PWM output drives servo Min/Center/Max and slider positions consistently.
- Sampler start/stop reports runtime activity and preserves capture continuity.
- Retransmit flow-control status is reported without corrupting captured script data.

## `009_ESP32_WIFI_VPN_BY_IP_EXECUTION`

### Local

- Script targets: `assets/default-scripts/blink.emw`, plus one representative hardware script from `008`.
- Setup: put an ESP32-S3 board on a home/lab LAN; provision Wi-Fi locally; connect the controller machine through a user-owned VPN, SSH tunnel, Tailscale subnet route, or equivalent routed private network. Do not use an EMWaver-hosted relay.
- Steps: start `emwaver gateway serve --wifi <private-ip>` from outside the LAN; run `emwaver run assets/default-scripts/blink.emw`; repeat with mDNS unavailable; verify the manual IP path in Gateway and macOS app where available; attempt a second simultaneous client and confirm `busy`; stop/reset the script and reconnect after a transient network drop.
- Tests: VPN-by-IP direct execution, manual endpoint entry when mDNS does not cross the tunnel, routed-network latency tolerance, busy handling, reconnect behavior, and local-first remote posture.
- Expected: scripts run through a user-owned routed path by private IP with LAN/VPN reachability as the trust boundary; no hosted relay, cloud account, subscription check, or backend device ownership check is involved.
- Evidence to record before marking passed: ESP32-S3 board model, firmware commit/hash or bundle version, user-owned routed path type, controller network location, private IP tested, exact CLI commands and exit results, gateway/macOS manual IP result where tested, second-client busy result, transient network drop/reconnect result, confirmation that no EMWaver-hosted relay/account path was used, date, and tester.
