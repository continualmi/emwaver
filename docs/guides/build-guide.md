# Build Guide

This guide is the practical starting point for reproducing EMWaver Shield.

## 1. Understand the target build

The current shield concept is a carrier around an ESP32-S3 DevKit-class module with:

- IR receiver and IR LED support,
- USB-C connectivity,
- a large duplicated GPIO breakout,
- footprint/support for an RFM69HW radio module and helical antenna.

The current catalog metadata also lists Android, iOS, and desktop app support for the resulting board experience.

## 2. Gather parts

Start with the checklist in [../reference/parts.md](../reference/parts.md).

At minimum, the current catalog entry expects:

- an ESP32-S3 DevKit,
- an RFM69HW module,
- a helical antenna.

Depending on the exact assembly path, you may also need standard passives, headers, and any IR components defined in the design files.

## 3. Open the design sources

Current design references:

- OSHWLab: [emwaver_diy_v2](https://oshwlab.com/maarnotto/emwaver_diy_v2)
- EasyEDA: [project `a9ecc255b85443dd9903fbab629f9e0b`](https://easyeda.com/editor#project_id=a9ecc255b85443dd9903fbab629f9e0b)

Use [../reference/design-sources.md](../reference/design-sources.md) for the current structure and what still needs to be imported into this repo.

## 4. Produce or collect fabrication files

Today, this repo does not yet contain committed local fabrication exports for the shield. So the near-term path is:

1. open the design in EasyEDA/OSHWLab,
2. export Gerbers, BOM, and pick-and-place data,
3. save those outputs into `hardware/revisions/v1/fabrication/`,
4. place the editable source package into `hardware/revisions/v1/source/`.

Once those files are committed here, this guide can switch to a fully self-contained local workflow.

## 5. Assemble the board

Recommended assembly order:

1. Solder the low-profile passives and support components first.
2. Add the IR components.
3. Add headers/connectors.
4. Add the RFM69HW radio section if you are building the radio-capable configuration.
5. Fit the ESP32-S3 DevKit carrier/module last so alignment stays easy.

As exact BOM/reference designators are added to the repo, this section should be tightened into a true step-by-step assembly checklist.

## 6. Bring-up

Near-term bring-up goal:

1. verify power and USB-C connection,
2. verify the ESP32-S3 DevKit seats correctly,
3. verify the radio module and antenna fitment if installed,
4. confirm the board is ready for the EMWaver app workflow.

This repository does not document a manual firmware-build workflow because that is not the intended EMWaver user path.

## 7. Known gaps

- Local EDA source exports are not yet committed.
- Local Gerbers/BOM/pick-and-place exports are not yet committed.
- Connector pinout and assembly photos still need to be promoted into step-by-step documentation.

That makes this a good organizing pass, but not yet the final reproduction package.
