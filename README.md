# EMWaver Shield Build Guide

![EMWaver Shield](catalog/images/EMWAVER_SHIELD.png)

EMWaver Shield is a shield-style carrier board for an ESP32-S3 module in the EMWaver hardware family.

This repository is primarily a build guide and hardware package for reproducing the board. It exists to collect the shield's public-facing hardware materials in one place: photos, catalog metadata, build notes, and design references.

EMWaver apps remain the normal software path. This repo is not the source of truth for private app, backend, provisioning, or internal firmware source.

## Build at a glance

1. Review the required parts and decide whether you are building the full radio-capable configuration.
2. Open the linked design sources and export the fabrication files you need if local manufacturing assets are not yet committed here.
3. Order the PCB and parts.
4. Assemble the board, including the ESP32-S3 DevKit carrier and the optional/target radio hardware.
5. Use the EMWaver apps for the software side rather than a manual firmware workflow.

## Current board direction

- Shield carrier for an ESP32-S3 DevKit-class module.
- IR receiver and IR LED support.
- USB-C oriented EMWaver workflow.
- RFM69HW radio module footprint with helical antenna support.
- Large duplicated GPIO breakout intended for prototyping and expansion.
- App support listed in the current catalog metadata: Android, iOS, and desktop.

## Required parts

Current minimum parts called out by the mirrored catalog metadata:

- ESP32-S3 DevKit
- RFM69HW module
- Helical antenna

You should also expect to need:

- the shield PCB,
- IR receiver,
- IR LED,
- headers / sockets for the carrier layout,
- standard passives and support components defined by the design files.

## Suggested tools

- soldering iron and solder
- flux
- tweezers
- side cutters
- multimeter
- USB-C cable

## Design sources

Current external design references:

- EasyEDA: [project `a9ecc255b85443dd9903fbab629f9e0b`](https://easyeda.com/editor#project_id=a9ecc255b85443dd9903fbab629f9e0b)

Current local mirrored catalog files:

- [catalog/device.json](catalog/device.json)
- [catalog/images/IMG_0063.jpg](catalog/images/IMG_0063.jpg)
- [catalog/images/IMG_0064.jpg](catalog/images/IMG_0064.jpg)
- [catalog/images/IMG_0065.jpg](catalog/images/IMG_0065.jpg)
- [catalog/images/IMG_0066.jpg](catalog/images/IMG_0066.jpg)
- [catalog/images/IMG_0067.jpg](catalog/images/IMG_0067.jpg)
- [catalog/images/IMG_0096.jpg](catalog/images/IMG_0096.jpg)
- [catalog/images/IMG_0097.jpg](catalog/images/IMG_0097.jpg)
- [catalog/images/EMWAVER_SHIELD.png](catalog/images/EMWAVER_SHIELD.png)

## Fabrication flow

This repo does not yet include committed local Gerbers, BOM, pick-and-place files, or editable EDA exports for the shield. Right now the practical path is:

1. Open the design in EasyEDA.
2. Export the fabrication package you need.
3. Save fabrication outputs under `hardware/revisions/v1/fabrication/`.
4. Save editable project/source files under `hardware/revisions/v1/source/`.
5. Save revision-specific pinout notes or manufacturing caveats under `hardware/revisions/v1/docs/`.

Once those files are committed here, this README can act as a fully self-contained reproduction guide.

## Assembly flow

Recommended assembly order:

1. Solder low-profile passives and support components first.
2. Add the IR components.
3. Add headers and connectors.
4. Add the RFM69HW radio section if you are building the full radio-capable variant.
5. Fit the ESP32-S3 DevKit carrier/module last so alignment stays easier.

## Bring-up checklist

1. Verify power rails and USB-C connection.
2. Verify the ESP32-S3 DevKit seats correctly.
3. Verify the RFM69HW module and antenna fitment if installed.
4. Confirm the board is ready for the EMWaver app workflow.

This repository intentionally does not document a manual firmware-build workflow because that is not the intended EMWaver user path.

## Repo layout

- `catalog/` mirrors the current `EMWAVER_SHIELD` entry from the EMWaver web hardware catalog, including all photos and the device manifest.
- `hardware/` is where revision-specific source files and manufacturing exports should live as they are brought into the repo.
- `assets/` is reserved for presentation material that is not part of the mirrored catalog package.

## Build status

The current source material available in-repo is the catalog package plus the remaining external design reference. Manufacturing exports and local revision source files still need to be added here as the hardware package is filled out.

<p align="center">
  <img src="catalog/images/EMWAVER_SHIELD.png" alt="EMWaver Shield render" width="70%" />
</p>

## Cost note

The mirrored catalog metadata currently lists a reproduction cost of `32 USD` for `5` units. Treat that as a rough catalog estimate rather than a finalized build quote.
