# EMWaver Hardware

This folder is the hardware package index for the EMWaver family. Each board
folder is intended to be usable on its own: the README should explain the board,
list build assets, document pinouts and connectors, and describe the bring-up
path without requiring someone to reverse-engineer the schematic first.

Current board folders:

```text
hardware/
  emwaver-air/
  emwaver-carrier/
  emwaver-core/
  emwaver-link/
  emwaver-shield/
  gpio-waver/
  infrared-waver/
  ism-waver/
  rfid-waver/
```

## Current Board Matrix

| Folder | MCU / controller | Main feature | Radio / peripheral | Normal app path |
| --- | --- | --- | --- | --- |
| `emwaver-air` | ESP32-S3-MINI-1-N8 | all-in-one wireless board | CC1101 433 MHz, IR RX/TX, expansion | Android, iOS, desktop |
| `emwaver-carrier` | bring-your-own ESP32-S3 DevKit | modular ESP32-S3 carrier | CC1101 module, IR RX/TX, expansion | Android, iOS, desktop |
| `emwaver-core` | STM32F042G6U6 | compact USB board | IR RX/TX, GPIO blocks | Android, iOS, desktop |
| `emwaver-link` | STM32F042G6U6 | integrated USB radio board | E07-400M10S / CC1101-class 433 MHz, IR RX/TX | Android, iOS, desktop |
| `emwaver-shield` | ESP32-S3 DevKit carrier | shield-style ESP32-S3 carrier | RFM69HW 433 MHz, IR RX/TX, 44-pin shield header | Android, iOS, desktop |
| `gpio-waver` | STM32F042G6U6 | low-cost GPIO prototyping | GPIO/SPI/UART/I2C headers | Android, desktop |
| `infrared-waver` | STM32F042G6U6 | infrared capture/replay | IR receiver and IR LED driver | Android, desktop |
| `ism-waver` | STM32F042G6U6 | dual-band sub-GHz work | CC1101, 315 MHz and 433 MHz RF paths | Android, desktop |
| `rfid-waver` | MFRC522 | RFID add-on module | 13.56 MHz RFID front end | Android, desktop with GPIO Waver |

## Build Asset Convention

Most board folders now include the same JLCPCB-style manufacturing package:

- `Schematic_*.pdf` - schematic export used for review and pinout checks.
- `PCB_*.pdf` - board-layout PDF export.
- `Gerber_*.zip` - fabrication archive to upload for PCB ordering.
- `BOM_*.csv` - assembly bill of materials.
- `PickAndPlace_*.csv` - CPL / pick-and-place data.
- `*.stl` - printable case files where available.
- `catalog/device.json` - website/catalog metadata mirrored into the hardware repo.

If a board README says a pinout needs physical verification, that means the
schematic identifies the nets but the committed package does not yet include a
clear annotated connector-orientation drawing. Do not treat those tables as a
replacement for a production assembly drawing.

## General JLCPCB Flow

1. Open the board README and confirm the exact build assets for that board.
2. Upload the `Gerber_*.zip` file to JLCPCB.
3. Select board options that match the Gerber defaults unless the README calls
   out a board-specific requirement.
4. For assembly, upload the matching `BOM_*.csv` and `PickAndPlace_*.csv`.
5. Review part availability, polarity, connector orientation, USB connector
   placement, antenna keepout, and any substitutions before placing the order.
6. On arrival, inspect for shorts, verify `VBUS` and `3V3` rails, connect over
   USB, and then use the EMWaver app-managed firmware/update flow.

## Firmware Rule

EMWaver hardware is local-first. Normal users should not need an account, cloud
activation, or manual firmware build to control local hardware.

For internal firmware development:

- STM32F042 boards use the workspace under `../stm/`.
- ESP32-S3 boards use the ESP-IDF workspace under `../esp/`.
- App-bundled firmware payloads live under `../firmware/` and platform bundle
  folders.

## Layout Policy

Each imported hardware repository keeps its original repo name directly under
`hardware/`. Do not add extra `boards/`, `modules/`, or other grouping folders
above the imported repos.

## Import Policy

- Preserve useful git history with `git subtree`, `git filter-repo`, or an equivalent history-preserving import.
- Keep imported hardware repos under `hardware/`; do not add imported files to the repo root.
- Keep app/runtime/platform source in the existing platform folders.
- Keep bundled app-consumed firmware payloads under `firmware/`.
- Keep manufacturing and board-specific documentation inside each hardware subfolder.
- Curate large generated manufacturing outputs carefully.
- Use Git LFS only if large binary assets become unavoidable.

## Current Status

The nine primary hardware repositories are imported with history preserved:

```text
hardware/emwaver-air/
hardware/emwaver-carrier/
hardware/emwaver-core/
hardware/emwaver-link/
hardware/emwaver-shield/
hardware/gpio-waver/
hardware/infrared-waver/
hardware/ism-waver/
hardware/rfid-waver/
```

See `hardware/IMPORT_INVENTORY.md` for the current source inventory and target prefix map.

## Import Script

`hardware/import-subtrees.sh` contains the repeatable history-preserving import commands.

The script refuses to run in a dirty worktree because `git subtree add` creates merge commits.

Trial import:

```bash
./hardware/import-subtrees.sh gpio-waver
```

Full import:

```bash
./hardware/import-subtrees.sh all
```
