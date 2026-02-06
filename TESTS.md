# EMWaver Current Hardware Test Suite

This document tracks the current manual tests we run today. It intentionally includes only the existing tests.

## `001_BLINK_LED_HOST_DEVICE_COMMS` `blink.emw` LED Blink

- Steps: connect the EMWaver board over USB, open `blink.emw`, and run it.
- Tests: host-device communication path and basic script runtime hardware execution.
- Expected: board LED blinks as defined by the script, with no communication stalls or run failures.

## `002_CC1101_INIT_AND_REGISTER_READBACK` CC1101 Settings + Register Readback (`cc1101.emw` + `ism.emw`)

- Steps: open `cc1101.emw`, click `initRx` or `initTx`, then open `ism.emw`, press `Initialize`, and read back all CC1101 registers.
- Tests: SPI communication with CC1101, RX/TX initialization path, and register write/readback integrity.
- Expected: configuration shows `115000` baud, `433.92 MHz`, and `ASK/OOK`, with no repeated-init garbage.

## `003_SAMPLER_CAPTURE_AND_RETRANSMIT_INTEGRITY` Sampler Capture + Retransmit Integrity (`sampler.emw` + `cc1101.emw`)

- Steps: in `cc1101.emw` press `initRx`; in `sampler.emw` record a real 433 MHz signal (for example a garage remote) and confirm the chart captures it continuously; in `cc1101.emw` press `initTx`; in `sampler.emw` press `Retransmit`; verify real receiver behavior matches pressing the original remote.
- Tests: sampler capture integrity, uninterrupted recording, CC1101 TX replay path, retransmit flow control, and end-to-end signal integrity.
- Expected: recording is uninterrupted, retransmit causes the same effect as the real remote, and optional RTL-SDR verification shows pulse widths within about 5-10 us margin for the sampler resolution setting.

## `004_SERVO_PWM_POSITION_CONTROL` Servo PWM Position Control (`pwm.emw`)

- Steps: connect a hobby servo signal line to the selected PWM pin, power the servo from external 5V, and share ground with EMWaver; open `pwm.emw`; press `Min`, `Center`, and `Max`; then use the slider and press `Move Slider Position` to test freeform position control.
- Tests: PWM output at servo control frequency, preset position control, and freeform pulse-width based position control on real servo hardware.
- Expected: servo moves to three distinct preset positions and tracks slider-selected positions consistently without stalled or ignored moves.

## `005_AGENT_MFRC522_UID_FULL_CYCLE` Agent Full Cycle for MFRC522 UID Read (`mfrc522_read_uid.emw`)

- Steps: wire MFRC522 (RC522) module to EMWaver over SPI, power it correctly, and place a valid RFID/NFC card near the reader; from Agent chat, run the full cycle (web fetch MFRC522 docs, generate script, run script, inspect results, iterate until stable); use this prompt in setup: `Use web fetch to read MFRC522 documentation, create mfrc522_read_uid.emw, run and iterate until the UI reliably reads and displays the card UID.`
- Tests: end-to-end agent workflow (research -> script generation -> execution -> iteration), web fetch usage for technical docs, SPI interaction with MFRC522, and reliable UID read path.
- Expected: agent produces `mfrc522_read_uid.emw`, script runs on device, card UID is read and shown in the script UI, and repeated reads are stable.

## `006_AGENT_MFRC522_BLOCK_WRITE_VERIFY_FULL_CYCLE` Agent Full Cycle for MFRC522 Block Write + Verify

- Steps: keep the same RC522 wiring and valid card setup; starting from `mfrc522_read_uid.emw`, run Agent chat full cycle again (web fetch MFRC522 datasheet/protocol details, add key selection + block number + write flow, execute and iterate until write/verify succeeds); use this prompt in setup: `Using mfrc522_read_uid.emw as base, fetch MFRC522 docs again and build a script that selects key and block, writes data, then reads back and verifies the same block value.`
- Tests: advanced agent workflow over multiple iterations, MFRC522 authentication flow, block write path, readback verification, and script UX for key/block selection.
- Expected: script can select key and block, write block data, and confirm by readback that written content matches expected value.
