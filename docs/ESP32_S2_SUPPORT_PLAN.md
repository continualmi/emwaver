# ESP32-S2 USB and Wi-Fi Support Plan

## Summary

ESP32-S2 support should reuse the existing ESP-IDF firmware workspace instead of duplicating ESP firmware. ESP32-S2 is a USB and Wi-Fi target only; it has no BLE radio. ESP32-S3 remains the ESP target for USB, BLE, and Wi-Fi.

## Implementation Shape

- Keep one shared EMWaver ESP protocol/runtime implementation under `esp/`.
- Compile BLE sources only for BLE-capable targets such as ESP32-S3.
- Compile a no-op BLE shim for ESP32-S2 so shared command-response code can stay transport-neutral.
- Report target-aware board metadata:
  - ESP32-S2: `board=esp32s2`, `cap=wifi,usb`
  - ESP32-S3: `board=esp32s3`, `cap=wifi,usb,ble`
- Keep USB, Wi-Fi provisioning, Wi-Fi WebSocket auth, and command/superframe behavior shared between ESP32-S2 and ESP32-S3.

## Implementation Status

Software support landed in `735a4c240 Add ESP32-S2 firmware target support`.

Implemented files:

- `esp/main/CMakeLists.txt` selects BLE/NimBLE sources only for `esp32s3` and uses `ble_server_stub.c` for non-BLE targets.
- `esp/main/libraries/emw_target.h` centralizes target metadata, capabilities, BLE availability, IR shield pin handling, and command task core selection.
- `esp/main/libraries/ble_server_stub.c` keeps shared command code linkable on ESP32-S2 without adding Bluetooth dependencies.
- `esp/main/libraries/init.c` uses target metadata for board responses, default device names, BLE startup, and S2-safe GPIO setup.
- `esp/main/libraries/wifi_transport.c` publishes target-aware mDNS `board` and `cap` TXT values.
- `esp/sdkconfig.defaults`, `esp/sdkconfig.defaults.esp32s2`, and `esp/sdkconfig.defaults.esp32s3` provide clean target defaults for USB MIDI, WebSocket support, partition sizing, and BLE target setup.
- `esp/README.md` documents S2/S3 as the primary ESP targets and keeps end-user firmware handling managed by EMWaver tooling.
- Android USB metadata inference distinguishes ESP32-S2, ESP32-S3, and generic ESP32 board names, and Android firmware-update UI keeps ESP boards out of the STM32 DFU flow without S3-only assumptions.
- macOS Wi-Fi records and firmware-update UI treat ESP32-S2, ESP32-S3, and generic ESP32 board names as ESP-family devices instead of assuming all ESP boards are ESP32-S3.
- Bundled default scripts detect ESP32-S2 as an ESP runtime target for shared GPIO/ADC/PWM/blink/sampler/CC1101 behavior, and report S2 accurately in scripts where ESP pin routing is not exposed yet.
- `web/lib/emwaver/exampleEmwScripts.ts` is regenerated from the default scripts so web-bundled examples preserve the same ESP32-S2 handling.

## Build Targets

Internal firmware developers can build either ESP target from the same workspace:

```bash
idf.py set-target esp32s2 build
idf.py set-target esp32s3 build
```

End users should still receive managed firmware through EMWaver tooling rather than building or flashing manually.

## Validation

Build validation completed:

- ESP32-S2 clean build passed with:
  `idf.py -B /tmp/emwaver-s2-isolated-build -DSDKCONFIG=/tmp/emwaver-s2-isolated-sdkconfig set-target esp32s2 build`
- ESP32-S3 clean build passed with:
  `idf.py -B /tmp/emwaver-s3-isolated-build -DSDKCONFIG=/tmp/emwaver-s3-isolated-sdkconfig set-target esp32s3 build`

Static validation completed:

- ESP32-S2 builds use `ble_server_stub.c`; BLE/NimBLE app sources are not in the `esp32s2` source list.
- ESP32-S3 builds include `ble_server.c`, `ota_ble.c`, `ota_ble_gatt.c`, and `bt`.
- ESP32-S2 metadata resolves to `board=esp32s2` and `cap=wifi,usb`.
- ESP32-S3 metadata resolves to `board=esp32s3` and `cap=wifi,usb,ble`.
- macOS metadata tests cover ESP32-S2, ESP32-S3, and generic ESP32 normalization for Wi-Fi records and firmware-update workflow selection. Targeted macOS `xcodebuild test` runs may hang in the runner on this machine; build-for-testing is the reliable local compile gate.
- Android board metadata tests cover ESP32-S2 USB product-name inference, generic ESP32 handling, and S2/S3/generic ESP exclusion from Android's STM32 DFU flow.
- Default script syntax validation covers the bundled `.emw` scripts after ESP32-S2 normalization.

Hardware validation still required on an attached ESP32-S2 board:

- ESP32-S2 enumerates over USB and responds to standard EMWaver command frames.
- ESP32-S2 can be provisioned for Wi-Fi over USB.
- ESP32-S2 advertises `_emwaver._tcp` with `board=esp32s2` and `cap=wifi,usb`.
- ESP32-S3 regression check confirms `board=esp32s3` and `cap=wifi,usb,ble` on physical hardware.

## Hardware Validation Runbook

Use this runbook when an ESP32-S2 board is attached. Replace `<PORT>`, `<SSID>`, `<PASSWORD>`, and `<SECRET>` with local values.

The scripted version is:

```bash
EMWAVER_ESP32_S2_PORT=<PORT> \
EMWAVER_DEVICE_ID=<DEVICE_ID> \
EMWAVER_WIFI_SSID=<SSID> \
EMWAVER_WIFI_PASSWORD=<PASSWORD> \
EMWAVER_WIFI_SECRET=<SECRET> \
EMWAVER_ESP32_S3_DEVICE_ID=<S3_DEVICE_ID> \
EMWAVER_ESP32_S3_MDNS_INSTANCE=<S3_INSTANCE_NAME> \
scripts/esp32-s2-hardware-validation.sh
```

`EMWAVER_ESP32_S3_DEVICE_ID` and `EMWAVER_ESP32_S3_MDNS_INSTANCE` are optional, but should be set when an ESP32-S3 board is attached so the script also checks the physical S3 board identity and mDNS regression. When `EMWAVER_MDNS_INSTANCE` or `EMWAVER_ESP32_S3_MDNS_INSTANCE` is set, the script fails if the advertised TXT records do not include the expected `board` and `cap` values.

1. Build and flash the S2 target:

```bash
cd esp
source setup.sh
idf.py set-target esp32s2
idf.py build
idf.py -p <PORT> flash monitor
```

2. Confirm USB enumeration:

```bash
python -m serial.tools.list_ports -v
```

Expected result: the flashed ESP32-S2 appears as a USB device/serial or USB MIDI-capable runtime, depending on host tooling.

3. Confirm the board identity command through the normal EMWaver USB command path.

Expected result: `EMW_OP_BOARD_GET` returns `esp32s2`.

4. Provision Wi-Fi through the normal EMWaver USB command path using:

```text
ssid=<SSID>
password=<PASSWORD>
secret=<SECRET>
```

Expected result: firmware reports Wi-Fi provisioned, joins station mode, and starts the `_emwaver._tcp` service.

5. Confirm mDNS TXT records from a machine on the same network:

```bash
dns-sd -B _emwaver._tcp local
dns-sd -L <INSTANCE_NAME> _emwaver._tcp local
```

Expected result: TXT records include `board=esp32s2` and `cap=wifi,usb`.

6. Run the S3 regression check with an ESP32-S3 board:

Expected result: board identity remains `esp32s3`, and mDNS TXT records include `board=esp32s3` and `cap=wifi,usb,ble`.

## Assumptions

- First ESP32-S2 support targets one known dev board before broad S2 compatibility is claimed.
- Pin defaults remain board-profile work and should be audited against the chosen ESP32-S2 board.
- No app-level protocol fork is introduced for ESP32-S2.
