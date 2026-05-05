# ISM Waver

![ISM Waver](catalog/images/IMG_0059.jpg)

ISM Waver is a dual-band sub-GHz board built around STM32F042G6U6 and CC1101.
It targets common 315 MHz and 433 MHz ISM workflows with native USB control.

## Build Assets

| File | Purpose |
| --- | --- |
| [Schematic_ISM_WAVER_2026-03-26.pdf](Schematic_ISM_WAVER_2026-03-26.pdf) | schematic review and RF net reference |
| [PCB_PCB_ISM_WAVER_2026-03-26.pdf](PCB_PCB_ISM_WAVER_2026-03-26.pdf) | board layout export |
| [Gerber_ISM_WAVER_PCB_ISM_WAVER_2026-03-26.zip](Gerber_ISM_WAVER_PCB_ISM_WAVER_2026-03-26.zip) | PCB fabrication upload |
| [BOM_ISM_WAVER_2026-03-26.csv](BOM_ISM_WAVER_2026-03-26.csv) | assembly BOM |
| [PickAndPlace_PCB_ISM_WAVER_2026-03-26.csv](PickAndPlace_PCB_ISM_WAVER_2026-03-26.csv) | CPL / pick-and-place |
| [ISM_WAVER_CASE.stl](ISM_WAVER_CASE.stl) | printable case |
| [catalog/device.json](catalog/device.json) | catalog metadata |

Catalog estimate: 5 units for about 50 USD.

## Major Components

| Area | Part / note |
| --- | --- |
| MCU | STM32F042G6U6, 48 MHz, native USB |
| Radio | TI CC1101 |
| RF bands | 315 MHz and 433 MHz matching networks |
| RF switching | FM8625H RF switch parts |
| Antennas | 315 MHz antenna and 433 MHz chip antenna |
| Crystal | 26 MHz RF crystal |
| USB / power | USB-C and NCP114AMX330TBG 3.3 V regulator |

## Radio And MCU Signals

| Signal | Function |
| --- | --- |
| `SCK` | CC1101 SPI clock |
| `MISO` / `SO(GDO1)` | CC1101 SPI MISO / GDO1 |
| `MOSI` | CC1101 SPI MOSI |
| `NSS` / `CSn` | CC1101 chip select |
| `GDO0` | CC1101 digital output / interrupt |
| `GDO2` | CC1101 digital output / interrupt |
| `VCTL` | RF switch control for band/path selection |
| `RF_P_315`, `RF_N_315` | 315 MHz differential RF path |
| `RF_P_433`, `RF_N_433` | 433 MHz differential RF path |
| `PA11`, `PA12` | USB `D-`, `D+` on STM32F042 |

RF documentation note: the committed schematic identifies RF networks and part
values, but production tuning should still be validated with RF test equipment
after any PCB, antenna, case, or part substitution.

## Manufacturing With JLCPCB

1. Upload `Gerber_ISM_WAVER_PCB_ISM_WAVER_2026-03-26.zip`.
2. Upload `BOM_ISM_WAVER_2026-03-26.csv` and
   `PickAndPlace_PCB_ISM_WAVER_2026-03-26.csv`.
3. Review CC1101 orientation, 26 MHz crystal, RF switch parts, matching network
   values, antenna parts, USB-C connector, regulator, and boot switch.
4. Avoid RF component substitutions unless the matching network is reviewed.
5. Preserve antenna keepouts and case clearances.

## Bring-Up Checklist

1. Verify `VBUS`, `VCC`, and `GND` before USB enumeration tests.
2. Confirm USB enumeration through the EMWaver app.
3. Read CC1101 part/version registers over SPI.
4. Test receive-only on 315 MHz and 433 MHz.
5. Test low-duty transmit and verify frequency/output behavior.
6. Validate range and thermal behavior in the final case.

## Firmware Development

Internal STM32 development lives in [`../../stm`](../../stm). Normal users
should use app-managed firmware and should not need manual flashing.
