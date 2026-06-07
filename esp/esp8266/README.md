# EMWaver ESP8266 Firmware

This workspace is the official-SDK ESP8266 port of EMWaver firmware.

ESP8266 is intentionally kept as a separate subworkspace under `esp/` because
it is not a target in modern ESP-IDF. It builds with Espressif's
`ESP8266_RTOS_SDK` v3.4 and exposes an EMWaver board class with Wi-Fi plus a USB-serial adapter path:

- `board=esp8266`
- `cap=wifi,serial`
- WebSocket runtime on port `3922`, path `/v1/ws`
- `_emwaver._tcp` mDNS advertisement when station mode is online
- the same 48-byte EMWaver SysEx/superframe payload used by ESP32 Wi-Fi
- a USB-serial EMWaver transport on UART0 at 115200 baud for local setup, recovery, and direct runtime commands

This target is for low-cost Wi-Fi control after setup, while still allowing
local USB-serial control when the board is cabled to a desktop. The serial path
exists because most ESP8266 dev boards expose a USB-serial adapter. It is not a
native USB device and it has no BLE fallback, so it is not a direct parity target
for ESP32-S3.

## Internal Developer Setup

Install the official ESP8266 RTOS SDK outside the repo:

```bash
mkdir -p ~/esp
cd ~/esp
git clone -b v3.4 --recursive https://github.com/espressif/ESP8266_RTOS_SDK.git
export IDF_PATH=~/esp/ESP8266_RTOS_SDK
python -m pip install --user -r "$IDF_PATH/requirements.txt"
```

Build from this workspace:

```bash
cd /Users/luisml/continualmi/emwaver/esp/esp8266
export IDF_PATH=~/esp/ESP8266_RTOS_SDK
make defconfig
make -j4
```

Flash a connected ESP8266 board:

```bash
make ESPPORT=/dev/cu.usbserial-XXXX flash monitor
```

Use the port name reported by your USB serial adapter. On Windows it will look
like `COM7`; on Linux it will usually look like `/dev/ttyUSB0`.

## Provisioning

Preferred setup uses the USB-serial bridge exposed by common ESP8266 dev boards.
Open the serial port at 115200 baud and send normal fixed 48-byte EMWaver SysEx
packets. The serial surface supports:

- version, reset, help
- hardware UID and board type
- device name get/set
- Wi-Fi provision/clear/status
- transport session status/connect/disconnect/heartbeat
- GPIO, ADC, UART, I2C, SPI, and PWM runtime commands

As a fallback, when no saved Wi-Fi credentials exist, the firmware also starts a
local SoftAP named `EMWaver-8266-XXXX`. Connect to that network and open the
WebSocket endpoint at:

```text
ws://192.168.4.1:3922/v1/ws
```

Send the normal `EMW_OP_WIFI_CONFIG` sequence over serial or that setup socket:

1. claim the transport with `EMW_OP_TRANSPORT_SESSION`
2. `EMW_WIFI_CFG_BEGIN`
3. one or more `EMW_WIFI_CFG_FIELD` chunks for SSID/password
4. `EMW_WIFI_CFG_APPLY`

After credentials are saved, the firmware restarts Wi-Fi in station mode,
advertises `_emwaver._tcp`, and accepts normal EMWaver Wi-Fi runtime sessions.
`EMW_WIFI_CFG_CLEAR` erases saved credentials and returns the board to SoftAP
setup mode.

## Supported Runtime Surface

The ESP8266 port supports the shared discovery/session opcodes plus the core
Wi-Fi runtime subset that maps cleanly to ESP8266 hardware:

- version, reset, hardware UID, board type, device name
- Wi-Fi provision/clear/status
- transport session claim/status/heartbeat/disconnect
- GPIO input/output/read/high/low/pull/info on GPIO 0-5 and 12-16
- ADC reads from the single TOUT/A0 channel
- UART open/close/write/read command surface through UART1 TX. Reads return an
  empty payload on ESP8266 because UART0 is reserved for the USB-serial EMWaver
  control transport and UART1 has no RX pin.
- I2C open/close/write/read/xfer on the configured software I2C pins, defaulting
  to GPIO4 SDA and GPIO5 SCL
- PWM write/frequency/stop through LEDC on one active channel
- SPI transfer through HSPI with caller-selected CS pin

Unsupported or intentionally constrained operations return `EMW_RESP_STATUS_ERR`.
Sampling and retransmit streaming are not enabled in this low-cost ESP8266 port
yet because they require the shared second-lane stream/circular-buffer transport
work used by ESP32 USB/BLE/Wi-Fi. ESP8266 GPIO 6-11 are flash pins and are
rejected for normal runtime control.
