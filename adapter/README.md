# BLE Waver Dongle (USB ↔ BLE adapter)

ESP32-S3 firmware for the BLE Waver Dongle: a small bridge that forwards data between:

- USB host (CDC-ACM device, e.g. a USB-serial device)
- BLE (single custom GATT service with a write + notify characteristic)

## BLE interface

- Custom service UUID: `45c7158e-0c3b-4e90-a847-452a15b14191`
- Custom characteristic UUID: `46c7158e-0c3b-4e90-a847-452a15b14191`

Behavior:

- Phone/client → dongle: GATT write → forwarded to USB (CDC-ACM TX)
- USB → dongle: CDC-ACM RX → forwarded to phone/client (GATT notify)

## Configuration

Settings are in `idf.py menuconfig` → `Adapter Configuration`:

- `ADAPTER_BLE_DEVICE_NAME` (default: `BLE Waver Dongle`)
- `ADAPTER_USB_VID` / `ADAPTER_USB_PID` (default: STM32 VCP `0x0483:0x5740`)
- `ADAPTER_USB_BAUD` (default: `115200`)

## Build & flash

From the repo root:

```bash
cd adapter
idf.py set-target esp32s3
idf.py build
idf.py -p /dev/ttyACM0 flash monitor
```

Replace the serial port as appropriate.
