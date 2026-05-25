# EMWaver Carrier

![EMWaver Carrier](catalog/images/IMG_0093.jpg)

EMWaver Carrier is the bring-your-own-MCU ESP32-S3 carrier board. It provides
USB-C, IR receive/transmit, CC1101 module support, and expansion headers around
an ESP32-S3 DevKit-class module.

## Visual Identification

Photos show a pale square carrier PCB with rounded corners, long parallel
female sockets for the ESP32-S3 DevKit footprint, two smaller 2x4 module sockets,
two IR parts near the top edge, and a USB-C connector on the lower edge. Assembled
photos show a blue ESP32-S3 DevKit and antenna/radio module plugged into the
carrier above a black EMWaver-branded lower face.

Images:

- [bare carrier top](catalog/images/IMG_0093.jpg)
- [assembled carrier with modules](catalog/images/IMG_0087.jpg)
- [case / enclosure reference](catalog/images/EMWAVER_DIY_CASING.png)
- [render](catalog/images/EMWAVER_DIY.png)

## Build Files

| File | Purpose |
| --- | --- |
| [Schematic_EMWAVER_CARRIER_2026-03-26.pdf](Schematic_EMWAVER_CARRIER_2026-03-26.pdf) | schematic review and net reference |
| [PCB_PCB_EMWAVER_CARRIER_2026-03-26.pdf](PCB_PCB_EMWAVER_CARRIER_2026-03-26.pdf) | board layout export |
| [Gerber_EMWAVER_CARRIER_PCB_EMWAVER_CARRIER_2026-03-26.zip](Gerber_EMWAVER_CARRIER_PCB_EMWAVER_CARRIER_2026-03-26.zip) | PCB fabrication upload |
| [BOM_EMWAVER_CARRIER_2026-03-26.csv](BOM_EMWAVER_CARRIER_2026-03-26.csv) | assembly BOM |
| [PickAndPlace_PCB_EMWAVER_CARRIER_2026-03-26.csv](PickAndPlace_PCB_EMWAVER_CARRIER_2026-03-26.csv) | assembly placement file |
| [EMWAVER_CARRIER_CASE.stl](EMWAVER_CARRIER_CASE.stl) | printable case |

Rough historical estimate: 2 units for about 38 USD.

## Required External Parts

- ESP32-S3 DevKit-class module.
- CC1101 module compatible with the board header.
- USB-C cable.

## Major Components

| Area | Part / note |
| --- | --- |
| MCU | user-supplied ESP32-S3 DevKit |
| Radio | user-supplied CC1101 module |
| IR receiver | Everlight IRM-H638T/TR2 |
| IR transmit | NTD3535I16 IR LED with AO3400A driver |
| Expansion | two 22-pin DevKit headers, one 8-pin add-on header, two 2x4 module headers |
| Power | USB 5 V input and 3.3 V logic rail from the DevKit/carrier design |

## Pinout And Signals

The schematic exposes these named nets. Verify physical orientation against the
PCB PDF before wiring modules.

| Signal | Function | ESP32-S3 GPIO |
| --- | --- | --- |
| `D+`, `D-` | USB data path | — (built-in USB) |
| `IR_RX` | IR receiver output | GPIO5 |
| `IR_TX` | IR LED driver input | GPIO4 |
| `MOSI` | SPI MOSI (CC1101 / expansion) | GPIO11 |
| `MISO` | SPI MISO (CC1101 / expansion) | GPIO13 |
| `SCK` | SPI clock (CC1101 / expansion) | GPIO12 |
| `NSS` | SPI chip-select (CC1101) | GPIO10 |
| `GDO0` | CC1101 interrupt / status | GPIO1 |
| `GDO2` | CC1101 interrupt / status | GPIO2 |
| `GPIO14`, `GPIO15` | spare ESP32-S3 GPIOs exposed on header | GPIO14, GPIO15 |
| `+5V`, `VCC`, `GND` | USB 5 V, 3.3 V logic, ground | — |

### ESP32-S3 firmware pin defaults

| Peripheral | GPIO | Notes |
| --- | --- | --- |
| CC1101 MOSI | 11 | |
| CC1101 MISO | 13 | |
| CC1101 SCK | 12 | |
| CC1101 CS (NSS) | 10 | |
| CC1101 GDO0 | 1 | interrupt / status |
| CC1101 GDO2 | 2 | interrupt / status |
| IR receiver (IR_RX) | 5 | |
| IR transmit (IR_TX) | 4 | primary; shield-compatible alt on GPIO37 |
| Spare | 14, 15 | exposed on header |

Align the installed DevKit and jumper/header routing with
those defaults or update firmware configuration intentionally.

## Manufacturing With JLCPCB

1. Upload `Gerber_EMWAVER_CARRIER_PCB_EMWAVER_CARRIER_2026-03-26.zip`.
2. Upload the matching BOM and pick-and-place file if ordering assembly.
3. Check DevKit socket/header placement, CC1101 header orientation, USB-C
   connector direction, and IR component polarity.
4. Do not substitute the CC1101 module footprint without checking RF and header
   compatibility.

## Assembly And Bring-Up

1. Assemble low-profile passives first, then USB/IR components, then headers.
2. Seat the ESP32-S3 DevKit only after checking for shorts on 5 V and 3.3 V.
3. Install the CC1101 module in the documented orientation.
4. Power over USB and confirm the DevKit enumerates.
5. Use the EMWaver app-managed setup/update flow for normal use.
6. Test USB, IR RX/TX, SPI module access, and GPIO expansion.

## Firmware

Normal users should not build firmware manually. EMWaver apps should handle
setup and updates for supported firmware builds.
