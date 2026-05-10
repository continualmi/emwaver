# EMWaver Hardware

EMWaver hardware turns supported MCU boards into local, scriptable electronics
tools. The normal path is simple: connect a supported board, let the EMWaver app
manage firmware setup, and run scripts locally.

## Boards

| Board | Controller | Best for | Radio / peripheral |
| --- | --- | --- | --- |
| [EMWaver Air](emwaver-air/README.md) | ESP32-S3-MINI-1-N8 | all-in-one wireless board | CC1101 433 MHz, IR RX/TX, expansion |
| [EMWaver Carrier](emwaver-carrier/README.md) | ESP32-S3 DevKit carrier | modular ESP32-S3 builds | CC1101 module, IR RX/TX, expansion |
| [EMWaver Core](emwaver-core/README.md) | STM32F042G6U6 | compact USB control | IR RX/TX, GPIO blocks |
| [EMWaver Link](emwaver-link/README.md) | STM32F042G6U6 | integrated USB radio | E07 / CC1101-class 433 MHz, IR RX/TX |
| [EMWaver Shield](emwaver-shield/README.md) | ESP32-S3 DevKit carrier | shield-style prototyping | RFM69HW 433 MHz, IR RX/TX, 44-pin shield header |
| [GPIO Waver](gpio-waver/README.md) | STM32F042G6U6 | GPIO prototyping | GPIO, SPI, UART, I2C headers |
| [Infrared Waver](infrared-waver/README.md) | STM32F042G6U6 | IR capture and replay | IR receiver and IR LED driver |
| [ISM Waver](ism-waver/README.md) | STM32F042G6U6 | sub-GHz ISM work | CC1101, 315 MHz and 433 MHz RF paths |
| [RFID Waver](rfid-waver/README.md) | MFRC522 add-on | 13.56 MHz RFID workflows | RFID front end for GPIO Waver |

## Build Files

Board pages link the files normally needed to review or reproduce the hardware:

- schematic PDF for electrical review,
- PCB PDF for placement and routing review,
- Gerber ZIP for PCB fabrication when available,
- BOM CSV and pick-and-place CSV for assembly,
- printable case STL files where available.

If a pinout table says the physical orientation still needs confirmation, use
the PCB PDF or an annotated board photo before making a cable or daughterboard.

## Ordering

1. Open the board page and confirm the exact files for that board.
2. Upload the Gerber ZIP to the PCB manufacturer.
3. If ordering assembly, upload the matching BOM and pick-and-place CSV.
4. Review component orientation, connector direction, substitutions, antenna
   keepouts, and case clearance before placing the order.
5. On arrival, inspect for shorts, verify power rails, connect over USB, and use
   the EMWaver app-managed setup/update flow.

## Firmware

EMWaver hardware is local-first. Local hardware control should not require an
account, cloud activation, or manual firmware build. Normal users should use the
managed firmware/update flow in the EMWaver apps.
