---
title: Pinout
---

# Pinout

![EMWaver device](../EMWAVER.jpg)

This page describes the **GPIO numbering model** used by EMWaver commands, and how it maps to STM32 port pins.

For the exact physical header orientation and any board-specific routing constraints, use the PCB PDF:

[PCB (PDF)](../hardware-catalog/hardware/pcb/PCB_emwaver_2025-12-09.pdf){ .md-button }

## GPIO blocks

EMWaver exposes two GPIO header “blocks”: **GPIO A** and **GPIO B**.

In scripts and commands, pins are addressed by a single integer:

- `0..15` maps to `PA0..PA15`
- `16..31` maps to `PB0..PB15`

### GPIO A (0–15)

| Index | MCU pin |
| ---: | :------ |
| 0 | PA0 |
| 1 | PA1 |
| 2 | PA2 |
| 3 | PA3 |
| 4 | PA4 |
| 5 | PA5 |
| 6 | PA6 |
| 7 | PA7 |
| 8 | PA8 |
| 9 | PA9 |
| 10 | PA10 |
| 11 | PA11 |
| 12 | PA12 |
| 13 | PA13 |
| 14 | PA14 |
| 15 | PA15 |

### GPIO B (16–31)

| Index | MCU pin |
| ---: | :------ |
| 16 | PB0 |
| 17 | PB1 |
| 18 | PB2 |
| 19 | PB3 |
| 20 | PB4 |
| 21 | PB5 |
| 22 | PB6 |
| 23 | PB7 |
| 24 | PB8 |
| 25 | PB9 |
| 26 | PB10 |
| 27 | PB11 |
| 28 | PB12 |
| 29 | PB13 |
| 30 | PB14 |
| 31 | PB15 |

## Notes

- Some pins may be reserved (USB, onboard peripherals) or not routed to headers on the current device revision.
- When in doubt, trust the board silkscreen + PCB PDF.
