---
title: Repository Layout
---

# Repository Layout

EMWaver is a monorepo: firmware + apps + desktop + CLI + documentation live together so they can evolve in lockstep.

## Top-Level Folders

| Path | What it is |
| --- | --- |
| `esp/` | ESP32-S3 firmware (ESP-IDF project) |
| `stm/` | STM32 firmwares (STM32CubeIDE projects: `stm/emwaver-gpio-firmware/`, `stm/emwaver-ir-firmware/`, `stm/emwaver-ism-firmware/`, `stm/emwaver-rfid-firmware/`) |
| `cli/` | Rust CLI (`emwaver`) for project init + device shell |
| `android/` | Android companion app |
| `ios/` | iOS companion app (SwiftUI) |
| `app/` | Desktop app (Tauri) mirroring mobile features |
| `docs/` | MkDocs source + generated site output (`docs/content`, `docs/mkdocs.yml`, `docs/docs`) |

## Firmware Templates vs. Firmware Sources

You’ll see references to a `main/` firmware layout in a few places:

- The **ESP32 firmware source** in this repo is under `esp/main/`.
- The **CLI** can generate a **new firmware project** template that contains a `main/` folder at the project root (matching ESP-IDF conventions).

So “`main/`” may refer to either:
- `esp/main/` (this repo), or
- `./main/` inside a *generated* firmware project created by `emwaver init`.

## Where To Go Next

- Firmware: [ESP32-S3](firmware-esp32.md), [STM32F042](firmware-stm32.md)
- Tooling: [CLI](cli.md)
- Protocol: [Transport & Command Format](protocol.md)
