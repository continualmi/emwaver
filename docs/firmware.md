# EMWaver Firmware

This page will provide an overview of the EMWaver firmware, its architecture, main modules, and how to update or flash the firmware.

- Firmware architecture and main modules
- BLE/USB communication overview
- How to update/flash firmware (browser-based and manual)

## Flash EMWaver Firmware

You can flash the latest EMWaver firmware to your device directly from your browser using the button below. This works best in Chrome or Edge on desktop, and requires a USB connection to your EMWaver device.

<script type="module" src="https://unpkg.com/esp-web-tools@10/dist/web/install-button.js?module"></script>

<esp-web-install-button
  manifest="/firmware/manifest.json">
</esp-web-install-button>

## Manual Flashing

If you prefer, you can download the merged firmware binary and flash it manually using esptool:

```sh
esptool.py --chip esp32s3 write_flash 0x0 emwaver-v1.bin
```

- [Download merged firmware](firmware/emwaver-v1.bin)
- [View manifest.json](firmware/manifest.json)

More details coming soon. 