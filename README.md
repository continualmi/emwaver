# EMWaver Link

![EMWaver Link](assets/images/emwaver-link.webp)

EMWaver Link is the STM32-based EMWaver board with built-in CC1101 radio support for the host-backed USB path of the EMWaver platform.

This repository is the device home for EMWaver Link. Its job is to collect everything needed to understand, build, order, document, and use the board in one place:

- hardware files,
- schematics,
- pin and connector documentation,
- product images,
- manufacturing and JLCPCB ordering guides,
- links back to the EMWaver product website and app entry points,
- and video/tutorial references.

## Purpose

EMWaver Link should feel like the single source of truth for this device. Someone landing in this README should be able to answer:

- What is this board for?
- Which MCU and peripherals does it use?
- What pins and connectors are exposed?
- Where are the schematic and board files?
- How do I order one from JLCPCB?
- How do I get started in the EMWaver app?
- Where can I watch demos or walkthroughs?

## Product Summary

EMWaver Link is the integrated radio-focused board in the EMWaver family.

- MCU class: STM32-based
- Radio path: built-in CC1101 support
- Primary host path: USB
- Platform role: host-backed EMWaver device
- Product positioning: same script-first EMWaver workflow as the rest of the platform, but with less setup friction for radio work

In practical terms, Link is meant to provide the same EMWaver software experience as modular boards while reducing the number of external parts a user needs to assemble before starting.

## Hardware Overview

The current intended identity of EMWaver Link is:

- STM32-based EMWaver board
- built-in CC1101 radio support
- native USB workflow
- part of the same software-first EMWaver platform as Core, Carrier, Air, and related devices

Suggested hardware documentation to keep in this repo:

- MCU exact part number and package
- radio chip/module details
- power input and regulation notes
- USB connector and data path notes
- clocks, debug/programming headers, and boot/recovery notes
- expansion headers or exposed IO
- board dimensions and mounting information

## Pinout

The canonical human-readable pinout should live directly in this README.

What should eventually be listed here:

- MCU pin to board-header mapping
- connector names and orientation notes
- power pins and safe voltage expectations
- USB data/power pins where relevant
- CC1101-related signal mapping
- GPIO capabilities such as ADC, PWM, interrupts, SPI, I2C, or UART where applicable

When the exact mapping is ready, it should be written here as tables and short notes. Images or PDFs can still exist elsewhere in the repo, but the readable version should stay in this README.

## Schematics And Board Files

This repo should contain all hardware design material needed to review or manufacture the board.

Recommended items:

- schematic source files
- PCB layout source files
- schematic PDF exports
- fabrication exports
- BOM exports
- CPL / pick-and-place exports
- assembly drawings
- 3D renders if available

If EMWaver Link depends on external libraries or footprints, document those versions and sources here too. The files themselves can live in folders, but the explanation of what exists and what each file is for should stay in this README.

Current committed hardware package:

- [Schematic PDF](Schematic_EMWAVER_LINK_2026-03-26.pdf)
- [BOM](BOM_EMWAVER_LINK_2026-03-26.csv)
- [Pick-and-place](PickAndPlace_PCB_EMWAVER_LINK_2026-03-26.csv)
- [Gerbers](Gerber_EMWAVER_LINK_PCB_EMWAVER_LINK_2026-03-26.zip)
- [PCB PDF](PCB_PCB_EMWAVER_LINK_2026-03-26.pdf)
- [Case STL](emwaver.stl)

## Ordering With JLCPCB

This repository should make it easy to order EMWaver Link without guessing.

Recommended JLCPCB guide contents:

1. Which ZIP or fabrication package to upload
2. Whether the board is PCB-only or PCB assembly ready
3. Which BOM and CPL files to provide
4. Any part substitutions that are allowed or not allowed
5. Notes about unavailable components or alternates
6. Any hand-assembly steps required after delivery
7. Bring-up checklist after the board arrives

The JLCPCB instructions should eventually live directly in this README and include:

- screenshot-friendly ordering steps,
- assembly options to select,
- board thickness / finish notes if they matter,
- and any known caveats for radio or USB-related parts.

## Getting Started With EMWaver

EMWaver Link is part of the EMWaver platform, so this repo should always point users back to the software experience once they have the hardware.

Recommended links to maintain here:

- EMWaver main product/site: `https://emwaver.ai`
- Link-specific getting-started page on the EMWaver website once available
- Link catalog/product page on the EMWaver website once available

Suggested onboarding flow to document here:

1. Get or assemble an EMWaver Link board
2. Install the EMWaver app on the supported platform
3. Sign in with a Continual account
4. Connect EMWaver Link over USB
5. Let EMWaver handle activation/update flow
6. Open a script and start using the built-in radio workflow

Important product rule: users should not need to manually build or flash firmware as part of the normal EMWaver Link getting-started path.

## Videos And Demos

This repo should also index the best media for understanding or demonstrating Link.

Useful video categories:

- product overview
- getting started
- radio workflow demo
- mobile workflow demo
- app + script UI demo
- manufacturing/build log

Recommended format for this section:

| Topic | Link |
| --- | --- |
| Product overview | TBD |
| Getting started with Link | TBD |
| Built-in radio workflow | TBD |
| Mobile demo | TBD |
| Ordering / build guide | TBD |

## Images

Current image assets:

- `assets/images/emwaver-link.webp` — current thumbnail / catalog image

As the repo grows, this should also include:

- clean top-down product photo
- angled hero photo
- bare PCB shot
- assembled board close-ups
- connector close-ups
- annotated board overview image

## Documentation Checklist

The following is the intended documentation set for this repo. Human-readable explanations should stay in this README even when source files, exports, images, or manufacturing assets live in subfolders.

- [x] Device overview README
- [ ] Pinout reference
- [x] Schematic PDF
- [x] Editable hardware design files
- [x] Gerber export
- [x] BOM export
- [x] CPL export
- [ ] JLCPCB ordering guide
- [ ] Assembly / bring-up guide
- [ ] EMWaver website links for Link
- [ ] Video index
- [ ] Troubleshooting notes

## Maintainer Notes

When updating this repository:

- keep this README as the full human-readable landing page for Link,
- keep explanations here even when design files or exports live elsewhere in the repo,
- update this README when new files, images, or ordering details become available,
- and keep product language aligned with EMWaver's software-first, managed-device platform direction.
