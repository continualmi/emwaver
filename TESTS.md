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
