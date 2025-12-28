---
title: Flashing Firmware
---

# Flashing Firmware

Pick the guide that matches your device family:

- **STM32 devices (STM32F042)**: Infrared Waver, ISM Waver, RFID Waver
- **ESP32 devices (ESP32-S3)**: EMWaver DIY, EMWaver Shield, EMWaver (flagship)

## Video Guides

### STM32 Flashing (Windows + ST Tools)

<div class="emw-youtube">
  <iframe
    src="https://www.youtube.com/embed/vVpXeJAoiaE"
    title="EMWaver STM32 Flashing"
    frameborder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen
  ></iframe>
</div>

### ESP32 Flashing (ESP-IDF + `idf.py`)

<div class="emw-youtube">
  <iframe
    src="https://www.youtube.com/embed/L5RjArbZA84"
    title="EMWaver ESP32 Flashing"
    frameborder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen
  ></iframe>
</div>

[![EMWavers YouTube Channel](../assets/emwavers-youtube-channel.jpg){ .emw-icon width="28" }](https://www.youtube.com/@EMWavers)
[EMWavers YouTube Channel](https://www.youtube.com/@EMWavers){ .md-button .md-button--primary }

## Written Guides

- [STM32 (STM32F042)](stm32.md)
- [ESP32 (ESP32-S3)](esp32.md)

## Web Flasher (ESP32 Stock Firmware)

Flash the **ESP32-S3 stock firmware** directly from your browser (WebSerial). Works best in Chrome or Edge on desktop and requires a USB connection.

<script type="module" src="https://unpkg.com/esp-web-tools@10/dist/web/install-button.js?module"></script>

<esp-web-install-button manifest="../assets/firmware/esp32s3/manifest.json"></esp-web-install-button>

Manual download:

- [emwaveresp-merged.bin](../assets/firmware/esp32s3/emwaveresp-merged.bin)
