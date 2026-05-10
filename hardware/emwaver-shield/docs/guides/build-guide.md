# Build Guide

This guide is the practical starting point for reproducing EMWaver Shield.

## 1. Understand the target build

The current shield concept is a carrier around an ESP32-S3 DevKit-class module with:

- IR receiver and IR LED support,
- USB-C connectivity,
- a large duplicated GPIO breakout,
- footprint/support for an RFM69HW radio module and helical antenna.

The resulting board is intended for the normal EMWaver app workflow on Android,
iOS, macOS, and Windows.

## 2. Gather parts

Start with the checklist in [../reference/parts.md](../reference/parts.md).

At minimum, plan for:

- an ESP32-S3 DevKit,
- an RFM69HW module,
- a helical antenna.

Depending on the exact assembly path, you may also need standard passives, headers, and any IR components defined in the design files.

## 3. Review the design files

Start with the local schematic, PCB review PDF, BOM, and pick-and-place files
listed in the main README.

## 4. Produce or collect fabrication files

Before ordering, confirm that the Gerber archive matches the schematic, PCB PDF,
BOM, and pick-and-place file for this board revision.

## 5. Assemble the board

Recommended assembly order:

1. Solder the low-profile passives and support components first.
2. Add the IR components.
3. Add headers/connectors.
4. Add the RFM69HW radio section if you are building the radio-capable configuration.
5. Fit the ESP32-S3 DevKit carrier/module last so alignment stays easy.

Use the BOM and pick-and-place files as the source of truth for exact
quantities, values, and reference designators.

## 6. Bring-up

Near-term bring-up goal:

1. verify power and USB-C connection,
2. verify the ESP32-S3 DevKit seats correctly,
3. verify the radio module and antenna fitment if installed,
4. confirm the board is ready for the EMWaver app workflow.

Manual firmware building is not the intended EMWaver user path.

## 7. Known gaps

- Confirm the final Gerber archive before ordering.
- Add a clearer connector-orientation photo.
- Add more assembly photos after a verified build.

Treat the schematic and PCB PDF as required references until the assembly photos
are complete.
