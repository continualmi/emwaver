---
title: Transport & Command Format
---

# Transport & Command Format

EMWaver uses a simple ASCII command protocol that is consistent across transports.

## Transports

| Platform | Transport |
| --- | --- |
| ESP32 family | BLE (custom service + command/notify characteristics) |
| STM32 family | USB CDC (virtual serial) |

## Message Shape

Commands are plain ASCII using Unix-style verbs and flags:

```text
spi --open --name cc1101 --port 2 --miso 13 --mosi 11 --sck 12 --cs 10 --clock 8000000
spi --write --name cc1101 --data 0x0f02aabbcc
spi --read --name cc1101 --len 4
spi --close --name cc1101
```

Responses mirror the structure:

```text
ok ...
err ...
```

## Design Goals

- **Human-friendly**: easy to type in a shell, copy/paste into scripts, and log.
- **Stable for clients**: Android, iOS, desktop, and CLI share the same surface.
- **Composable**: simple verbs for SPI, sampling, GPIO, etc.

## Where This Is Used

- `emwaver shell` sends these commands and prints `ok`/`err` responses.
- The mobile and desktop apps use the same verbs behind their UI.

