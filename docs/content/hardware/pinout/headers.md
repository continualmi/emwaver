---
title: Headers
---

# Headers

Infrared and CC1101 pins are internal-only and are not routed to headers:

| Pin | Function |
| :--- | :--- |
| A0 | IR_RX |
| A1 | IR_TX |
| A2 | CC1101 GDO0 |
| A3 | CC1101 GDO2 |

## 1x8

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| VCC | B6 | GND | B7 | A6 (MISO) | A7 (MOSI) | A5 (SCK) | A13 (SWCLK) |

## 2x4

Pin numbering follows the common 2xN convention (odd pins on the bottom row, even pins on the top row).

| 2: VCC | 4: A14 (SWDIO) | 6: A7 (MOSI) | 8: B7 |
| --- | --- | --- | --- |
| 1: GND | 3: B6 | 5: A5 (SCK) | 7: A6 (MISO) |
