<div align="center">
  <img src="banner.jpeg" alt="EMWaver Banner" width="100%">
</div>

<div align="center">
  <p>
    <a href="https://luispl77.github.io/emwaver/"><strong>Docs</strong></a> ·
    <a href="https://www.youtube.com/@EMWavers"><strong>YouTube</strong></a> ·
    <a href="https://luispl77.github.io/emwaver-hardware/"><strong>Hardware Catalog</strong></a> ·
    <a href="https://github.com/luispl77/emwaver/releases"><strong>Releases</strong></a>
  </p>
</div>

EMWaver is an open-source, multi-target project: firmware (ESP32-S3 + STM32F042), companion apps (Android/iOS/Desktop), a Rust CLI, and MkDocs documentation.

## Get Started

<div align="center">
  <a href="https://play.google.com/store/apps/details?id=com.emwaver.app">
    <img src="docs/content/badges/google-play.png" alt="Get it on Google Play" height="52">
  </a>
  <a href="https://apps.apple.com/app/emwaver">
    <img src="docs/content/badges/app-store.png" alt="Download on the App Store" height="52">
  </a>
</div>

### Flashing Guides (Docs + Videos)

- STM32 (Infrared/ISM/RFID Waver): `https://luispl77.github.io/emwaver/flashing-firmware/stm32/` · Video: https://youtu.be/vVpXeJAoiaE
- ESP32-S3 (Flagship/Shield/DIY): `https://luispl77.github.io/emwaver/flashing-firmware/esp32/` · Video: https://youtu.be/L5RjArbZA84

### Install The CLI

```bash
curl -fsSL https://raw.githubusercontent.com/luispl77/emwaver/main/cli/install.sh | sh
```

Then:

```bash
emwaver shell
emwaver init --target esp32s3 --path ./my-esp32-fw
emwaver init --target stm32f042 --path ./my-stm32-fw
```

## Apps & Tools

- Android app: `android/`
- iOS app: `ios/`
- Desktop app: `app/`
- CLI: `cli/`

## Firmware

- ESP32-S3 firmware (ESP-IDF): `esp/`
- STM32F042 firmware (STM32CubeIDE/CubeMX): `stm/emwaver-firmware/`
- BLE adapter firmware (USB↔BLE dongle, ESP32-S3): `adapter/`

## Documentation

- Docs site: `https://luispl77.github.io/emwaver/`
- Technical reference hub: `https://luispl77.github.io/emwaver/documentation/`
- Build & reproduce hardware: `https://luispl77.github.io/emwaver/hardware-catalog/`

## License

This project is open source and available under the `LICENSE` file.
