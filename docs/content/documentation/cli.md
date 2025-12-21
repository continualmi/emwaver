---
title: CLI (emwaver)
---

# CLI (emwaver)

The Rust CLI lives in `cli/` and is the fastest way to:

- initialize firmware projects, and
- talk to devices directly using an interactive shell.

## Install

Recommended installer:

```bash
curl -fsSL https://raw.githubusercontent.com/luispl77/emwaver/main/cli/install.sh | sh
```

## Common Commands

```bash
# Interactive device shell (BLE on ESP32 family)
emwaver shell

# Generate an ESP32-S3 firmware project
emwaver init --target esp32s3 --path ./my-esp32-fw

# Generate an STM32F042 firmware project
emwaver init --target stm32f042 --path ./my-stm32-fw
```

## Dev / Build From Source

```bash
cd cli
cargo build
cargo test
```

