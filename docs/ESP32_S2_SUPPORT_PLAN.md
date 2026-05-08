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
scripts/esp32-s2-hardware-validation.sh
```

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
