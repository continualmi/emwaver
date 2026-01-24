---
title: GPIOs
---

# GPIOs

Pins are addressed by a single integer:

- `0..15` maps to `A0..A15` (PA0..PA15)
- `16..31` maps to `B0..B15` (PB0..PB15)

Only the following pins are relevant on the current board:

| GPIO index | Pin | Notes |
| ---: | :--- | :--- |
| 0 | A0 (PA0) | IR_RX (internal) |
| 1 | A1 (PA1) | IR_TX (internal) |
| 2 | A2 (PA2) | CC1101 GDO0 (internal) |
| 3 | A3 (PA3) | CC1101 GDO2 (internal) |
| 4 | A4 (PA4) | NSS |
| 5 | A5 (PA5) | SCK |
| 6 | A6 (PA6) | MISO |
| 7 | A7 (PA7) | MOSI |
| 13 | A13 (PA13) | SWCLK |
| 14 | A14 (PA14) | SWDIO |
| 22 | B6 (PB6) | UART TX / I2C SCL |
| 23 | B7 (PB7) | UART RX / I2C SDA |
