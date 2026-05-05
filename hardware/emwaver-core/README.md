# EMWaver Core

![EMWaver Core](catalog/images/EMWAVER.png)

EMWaver Core is the compact STM32F042G6U6 USB board without a built-in CC1101
radio. It keeps the core EMWaver local hardware-control surface: USB-C, IR
receive/transmit, and GPIO/module headers.

## Build Assets

| File | Purpose |
| --- | --- |
| [Schematic_EMWAVER_CORE_2026-03-26.pdf](Schematic_EMWAVER_CORE_2026-03-26.pdf) | schematic review and net reference |
| [PCB_PCB_EMWAVER_CORE_2026-03-26.pdf](PCB_PCB_EMWAVER_CORE_2026-03-26.pdf) | board layout export |
| [Gerber_EMWAVER_CORE_PCB_EMWAVER_CORE_2026-03-26.zip](Gerber_EMWAVER_CORE_PCB_EMWAVER_CORE_2026-03-26.zip) | PCB fabrication upload |
| [BOM_EMWAVER_CORE_2026-03-26.csv](BOM_EMWAVER_CORE_2026-03-26.csv) | assembly BOM |
| [PickAndPlace_PCB_EMWAVER_CORE_2026-03-26.csv](PickAndPlace_PCB_EMWAVER_CORE_2026-03-26.csv) | CPL / pick-and-place |
| [EMWAVER_CORE_CASE_FRONT.stl](EMWAVER_CORE_CASE_FRONT.stl) | front case shell |
| [EMWAVER_CORE_CASE_BACK.stl](EMWAVER_CORE_CASE_BACK.stl) | back case shell |
| [catalog/device.json](catalog/device.json) | catalog metadata |

## Major Components

| Area | Part / note |
| --- | --- |
| MCU | STM32F042G6U6, 48 MHz, native USB |
| IR receiver | Everlight IRM-H638T/TR2 |
| IR transmit | NTD3535I16 IR LED with AO3400A driver |
| USB | USB-C receptacle with CC resistors |
| Power | USB 5 V input, AMS1117-3.3 regulator |
| Headers | 2x4 module header and 1x8 GPIO/RFID-style header |

## Pinout And Firmware Signals

The STM32 firmware maps USB, SPI, IR, UART/I2C, PWM, and ADC features onto the
STM32F042 pins below. Confirm connector orientation in the PCB PDF before
building a cable or add-on.

| MCU pin / net | Firmware role |
| --- | --- |
| `PA0` | GPIO, ADC0, TIM2 PWM CH1 |
| `PA1` | `IR_RX`, GPIO, ADC1, TIM2 PWM CH2 |
| `PA2` | `IR_TX`, GPIO, ADC2, TIM2 PWM CH3 |
| `PA3` | GPIO, ADC3, TIM2 PWM CH4 |
| `PA4` | `NSS_RFID`, GPIO/SPI chip select |
| `PA5` | `SPI1_SCK` |
| `PA6` | `SPI1_MISO` |
| `PA7` | `SPI1_MOSI` |
| `PA11` | USB `D-` |
| `PA12` | USB `D+` |
| `PB6` | GPIO, USART1 TX, I2C1 SCL |
| `PB7` | GPIO, USART1 RX, I2C1 SDA |
| `BOOT0` | boot mode / DFU entry path |
| `VCC`, `VBUS`, `GND` | 3.3 V logic, USB 5 V, ground |

Known connector intent from firmware docs:

| Connector | Intended signals |
| --- | --- |
| `CN1` 2x4 | `VCC`, `GND`, `NSS`, `SCK`, `MOSI`, `MISO`, `GDO0`, `GDO1/GDO2`-style GPIO for CC1101-class modules |
| `U4` 1x8 | `VCC`, `PB6`, `BOOT0`, `MISO`, `MOSI`, `NSS`, `SCL`, `PB7` for RC522/GPIO-style add-ons |

## Manufacturing With JLCPCB

1. Upload `Gerber_EMWAVER_CORE_PCB_EMWAVER_CORE_2026-03-26.zip`.
2. Upload `BOM_EMWAVER_CORE_2026-03-26.csv` and
   `PickAndPlace_PCB_EMWAVER_CORE_2026-03-26.csv` for assembly.
3. Review STM32 orientation, USB-C connector, IR LED polarity, IR receiver
   orientation, regulator, and headers.
4. Check whether any substituted regulator or USB part changes the case fit.

## Bring-Up Checklist

1. Inspect for solder bridges around the STM32, USB-C, and regulator.
2. Power from USB and verify `VBUS` and `VCC` before connecting add-ons.
3. Confirm USB enumeration.
4. Use the EMWaver app-managed firmware/update path for normal use.
5. Test IR receive, IR transmit, SPI add-on access, GPIO read/write, ADC, and
   PWM.

## Firmware Development

Normal users should not build firmware manually. Internal STM32 development
lives in [`../../stm`](../../stm). App updaters consume `.bin` payloads, not the
CubeIDE `.elf` directly.
