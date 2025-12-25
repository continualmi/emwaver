---
title: Contributing
---

# Contributing

## Repo Principles

- Keep changes scoped (avoid mixing unrelated edits).
- Don’t commit secrets (tokens, pairing keys, Wi‑Fi creds). Use runtime configuration instead.
- Prefer keeping platform behavior aligned (Android, iOS, desktop should mirror capabilities).

## Firmware Notes

- ESP32 firmware is an ESP-IDF project under `esp/`.
- STM32 firmware lives under `stm/` as multiple CubeIDE projects (GPIO/IR/ISM/RFID).
- Treat build artifacts as disposable (`build/`, `*.elf`, `*.bin`).

## Docs

- Docs are built with MkDocs Material from `docs/mkdocs.yml`.
- Keep device-facing instructions consistent with the firmware command protocol and the CLI UX.
