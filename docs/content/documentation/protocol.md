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

Commands are plain ASCII using Unix-style verbs and flags. The ESP32-S3 firmware registers
the following command families:

```text
version
ble?
stop

gpio in --pin 4
gpio out --pin 4
gpio pull --pin 4 --mode 1
gpio high --pin 4
gpio low --pin 4
gpio read --pin 4

spi open --name cc1101 --host 2 --miso 13 --mosi 11 --sck 12 --cs 10 --mode 0 --clock 8000000 --cs_active_high 0
spi xfer --name cc1101 --tx 0x0f02aabbcc --rx 4
spi close --name cc1101

sample start --pin 5
sample stop
transmit start --pin 37 --pwm true --freq 38000 --duty 50
transmit stop

usb STRING "Hello"
```

Radio front-ends include `cc1101 *` and `rfm69 *` command groups for initialization,
register access, modulation, and power configuration.

## Command Reference (ESP32-S3)

### Core

- `version` → returns firmware version string.
- `ble?` → returns `on` when BLE is up.
- `stop` → stops sampler + transmission.

### GPIO

| Command | Arguments | Notes |
| --- | --- | --- |
| `gpio in` | `--pin <int>` | Configure GPIO as input. |
| `gpio out` | `--pin <int>` | Configure GPIO as output. |
| `gpio pull` | `--pin <int>` `--mode <0|1|2>` | `0`=float, `1`=pull-up, `2`=pull-down. |
| `gpio high` | `--pin <int>` | Sets output high and returns `0x01`. |
| `gpio low` | `--pin <int>` | Sets output low and returns `0x00`. |
| `gpio read` | `--pin <int>` | Returns `0x00` or `0x01`. |

### SPI

SPI devices are created by name and tracked internally; transfers are capped at 64 bytes.

| Command | Arguments | Notes |
| --- | --- | --- |
| `spi open` | `--name <str>` `--host <1..3>` `--miso <int>` `--mosi <int>` `--sck <int>` `--cs <int>` `--mode <0..3>` `--clock <hz>` `--cs_active_high <0|1>` | Opens a device on the selected host (default host 2, default clock 1 MHz). |
| `spi xfer` | `--name <str>` `--tx <hex>` `--rx <len>` | Either or both of `tx`/`rx` may be supplied. |
| `spi close` | `--name <str>` | Closes a named device. |

### Sampler / Transmit

| Command | Arguments | Notes |
| --- | --- | --- |
| `sample start` | `--pin <int>` | Starts capture on a GPIO pin. |
| `sample stop` | *(none)* | Stops capture. |
| `transmit start` | `--pin <int>` `--pwm <bool>` `--freq <hz>` `--duty <percent>` | PWM defaults to 38 kHz @ 50% when enabled. |
| `transmit stop` | *(none)* | Stops transmission. |

### USB HID (BadUSB-style)

The USB command is a two-argument positional command: `usb <action> <data>`.

| Action | Data | Notes |
| --- | --- | --- |
| `ATTACKMODE` | *(optional)* | Initializes TinyUSB HID. |
| `STRING_DELAY` | `<ms>` | Sets per-character delay (1–999 ms). |
| `STRING` | `<text>` | Types the provided text. |
| `ENTER` | *(optional)* | Sends an Enter keypress. |
| `DELAY` | *(unused)* | No-op placeholder. |
| *(other)* | `<text>` | Sends `<action> <text>` as typed input. |

### CC1101

| Command | Arguments | Notes |
| --- | --- | --- |
| `cc1101 init` | `--miso` `--mosi` `--sck` `--cs` `--cs_active_high` | Uses default pins if omitted. |
| `cc1101 write` | `--reg <int>` `--val <int>` | Write register. |
| `cc1101 read` | `--reg <int>` | Read register (1 byte). |
| `cc1101 read_burst` | `--reg <int>` `--len <int>` | Burst read. |
| `cc1101 write_burst` | `--reg <int>` `--data <hex>` | Burst write. |
| `cc1101 strobe` | `--cmd <int>` | Sends a command strobe. |
| `cc1101 apply_defaults` | *(none)* | Applies default register config. |
| `cc1101 set_freq` | `--mhz <str>` | Set frequency (MHz string). |
| `cc1101 get_freq` | *(none)* | Returns frequency. |
| `cc1101 set_datarate` | `--bps <int>` | Set data rate. |
| `cc1101 get_datarate` | *(none)* | Returns data rate. |
| `cc1101 set_mod` | `--mod <str>` | Modulation mode. |
| `cc1101 get_mod` | *(none)* | Returns modulation. |
| `cc1101 set_mod_power` | `--mod <int>` `--dbm <int>` | Modulation + power. |
| `cc1101 set_gdo` | `--data <hex>` | 3-byte GDO config. |

### RFM69

| Command | Arguments | Notes |
| --- | --- | --- |
| `rfm69 init` | `--miso` `--mosi` `--sck` `--cs` `--cs_active_high` | Uses default pins if omitted. |
| `rfm69 apply_defaults` | *(none)* | Applies default register config. |
| `rfm69 write` | `--reg <int>` `--val <int>` | Write register. |
| `rfm69 read` | `--reg <int>` | Read register (1 byte). |
| `rfm69 set_mode` | `--mode <str>` | Operating mode. |
| `rfm69 set_freq` | `--mhz <str>` | Set frequency. |
| `rfm69 get_freq` | *(none)* | Returns frequency. |
| `rfm69 set_bitrate` | `--bps <int>` | Set bitrate. |
| `rfm69 get_bitrate` | *(none)* | Returns bitrate. |
| `rfm69 set_dev` | `--hz <int>` | Set deviation. |
| `rfm69 get_dev` | *(none)* | Returns deviation. |
| `rfm69 set_power` | `--dbm <int>` `--pa_mode <int>` `--ocp <bool>` | Set TX power. |
| `rfm69 get_power` | *(none)* | Returns TX power. |
| `rfm69 set_bw` | `--val <int>` | Raw bandwidth register. |
| `rfm69 get_bw` | *(none)* | Returns bandwidth register. |
| `rfm69 set_bw_khz` | `--khz <str>` | Bandwidth in kHz. |
| `rfm69 get_bw_khz` | *(none)* | Returns bandwidth kHz. |
| `rfm69 set_mod` | `--mod <str>` | Modulation mode. |
| `rfm69 get_mod` | *(none)* | Returns modulation. |
| `rfm69 thresh_fixed` | `--fixed <bool>` | Fixed/variable threshold. |
| `rfm69 set_lna_gain` | `--gain <int>` | LNA gain step. |
| `rfm69 set_rssi_thresh` | `--thresh <int>` | RSSI threshold. |
| `rfm69 set_fixed_thresh` | `--thresh <int>` | Fixed threshold. |
| `rfm69 set_sens_boost` | `--enabled <bool>` | Sensitivity boost. |
| `rfm69 read_rssi` | `--force <bool>` | Read RSSI (optional trigger). |

## Response Framing (ESP32 BLE)

The BLE transport returns **raw bytes**, not ASCII `ok`/`err` strings:

- **Success with payload**: payload bytes returned as-is.
- **Success without payload**: a single `0x00` ACK byte.
- **Error**: a single `0xFF` byte.

Higher-level clients (CLI/apps) translate these bytes into human-readable status lines.

## Design Goals

- **Human-friendly**: easy to type in a shell, copy/paste into scripts, and log.
- **Stable for clients**: Android, iOS, desktop, and CLI share the same surface.
- **Composable**: simple verbs for SPI, sampling, GPIO, etc.

## Where This Is Used

- `emwaver shell` sends these commands and prints `ok`/`err` responses.
- The mobile and desktop apps use the same verbs behind their UI.
