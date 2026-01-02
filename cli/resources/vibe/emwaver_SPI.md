---
title: SPI Vibe Hacking
type: guide
---

# SPI Vibe Hacking

This is a practical cheat-sheet for probing SPI modules using EMWaver’s ASCII commands.

## Packet/CLI constraints

- Commands must fit in a **64-byte** packet on the wire.
- Prefer `--key=value` (shorter than `--key value`).
- Use `emwaver cmd --verbose "<cmd>"` to see both `hex:` and `ascii:` output.

## EMWaver SPI commands

- `spi open --name=<id> --miso=<pin> --mosi=<pin> --sck=<pin> --cs=<pin>`
- `spi xfer --name=<id> --tx=<hexbytes> --rx=<n>`
- `spi close --name=<id>`

Hex byte parsing accepts comma/colon/space separated tokens, and `0x` prefixes:
- `--tx=0xF1,0x00`
- `--tx=241,0` (decimal also works)

## Interpreting `spi xfer` results

Most SPI peripherals return a “status” byte while you clock the first command byte. For reads, you usually need to send a dummy byte to clock out the data.

If you request `--rx=2`, you will typically see:
- byte0: peripheral **status** during command phase
- byte1: **data** returned while clocking the dummy byte

## CC1101 example: read `VERSION` (expects `0x14`)

CC1101’s `VERSION` is a *status register*, so you must set the `0xC0` read/status bits:
- `VERSION` address: `0x31`
- Read/status command: `0x31 | 0xC0 = 0xF1`

Commands:
- `spi open --name=c --miso=13 --mosi=11 --sck=12 --cs=10`
- `spi xfer --name=c --tx=0xF1,0x00 --rx=2`
- Expect: `hex: <status> 14 ...`

## NRF24L01(+) example: read core registers (CS=14)

NRF24 uses `R_REGISTER` with `cmd = 0x00 | (reg & 0x1F)`. Send one dummy byte to clock the register value out.

Commands:
- `spi open --name=n --miso=13 --mosi=11 --sck=12 --cs=14`
- `spi xfer --name=n --tx=0x00,0x00 --rx=2` (reg `0x00 CONFIG`)

Useful “is it alive?” registers (common reset defaults shown):
- `0x00 CONFIG` → `0x08`
- `0x01 EN_AA` → `0x3F`
- `0x02 EN_RXADDR` → `0x03`
- `0x03 SETUP_AW` → `0x03`
- `0x04 SETUP_RETR` → `0x03`
- `0x05 RF_CH` → `0x02`
- `0x06 RF_SETUP` → `0x0F`
- `0x07 STATUS` → often `0x0E`
