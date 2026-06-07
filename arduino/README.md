# Arduino Firmware

This folder contains EMWaver firmware sketches for non-ESP Arduino-compatible
boards. ESP targets stay under `esp/`; Raspberry Pi Pico/RP2040 targets should
use a separate Pico SDK workspace when added.

The supported app transport for this family is USB Serial. Boards run a managed
EMWaver sketch that speaks the same 48-byte EMWaver SysEx packet used by the
macOS USB Serial runtime transport.

## Tooling

Use Arduino CLI for automated builds and uploads. The Arduino IDE can open the
same sketches for manual inspection, but it is not the intended app/tooling
backend.

Recommended CLI setup for AVR boards:

```sh
arduino-cli core install arduino:avr
arduino-cli compile --fqbn arduino:avr:uno arduino/avr/emwaver_arduino_avr
arduino-cli upload -p /dev/cu.usbmodemXXXX --fqbn arduino:avr:uno arduino/avr/emwaver_arduino_avr
```

Common FQBNs:

- Uno / compatible: `arduino:avr:uno`
- Nano ATmega328P: `arduino:avr:nano`
- Mega 2560: `arduino:avr:mega`

## AVR Target

`avr/emwaver_arduino_avr/` is the first Arduino target. It is intended for
classic Uno/Nano/Mega-style boards and starts with the protocol surface that
fits the small AVR runtime:

- firmware version, board type, and local UID probes,
- GPIO input/output/read/pull/high/low/info,
- ADC pin reads,
- PWM frequency/write/stop via `analogWrite`,
- SPI transfer with caller-provided chip-select pin.

AVR boards do not expose a factory hardware UID. The sketch stores a local
six-byte identifier in EEPROM on first boot. It is only for local labels and
device-list deduplication; it is not activation, ownership, or account state.

## Protocol Notes

The sketch receives and transmits one EMWaver packet at a time:

- 48-byte SysEx packet: `F0 7D 45 4D 57 ... F7`
- 42 encoded payload bytes
- 36 decoded superframe bytes
- first 18 bytes are the command lane
- responses return an `OK`/`ERR`/`BUSY` status in the command lane

The packet protocol intentionally matches the USB Serial runtime path used by
ESP8266 so native apps do not need a board-family-specific command transport.
