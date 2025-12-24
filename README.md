<div align="center">
  <img src="docs/content/banner.jpeg" alt="EMWaver Banner" width="100%">
</div>

<div align="center">
  <p>
    <a href="https://luispl77.github.io/emwaver/"><strong>Docs</strong></a> ·
    <a href="https://www.youtube.com/@EMWavers"><strong>YouTube</strong></a> ·
    <a href="https://luispl77.github.io/emwaver-hardware/"><strong>Hardware Catalog</strong></a> ·
    <a href="https://github.com/luispl77/emwaver/releases"><strong>Releases</strong></a>
  </p>
</div>

EMWaver is a fully open-source, offline-first hardware hacking and development platform — designed to be a more powerful and cost-effective alternative to platforms like Flipper Zero and Arduino by treating your phone and PC as part of the “device”.

Instead of cramming everything into firmware, EMWaver devices connect directly over BLE or USB and lean on the resources you already have (CPU, memory, storage, UI). That lets you build workflows that are hard or impossible with firmware alone: richer interfaces, bigger captures, faster iteration loops, and scripted procedures that can evolve without reflashing. The ecosystem includes mobile apps, a desktop app, and the EMWaver CLI (for fast project generation and automation). EMWaver also introduces a middleware layer called Wavelets: self-contained scripts written in a JavaScript-like language (EMWaver DSL) that automate hardware workflows and render portable UI components across Android, iOS, and desktop in a consistent way.

Hardware comes in two platform families: STM32 devices are ultra low-cost, USB-only, and optimized for the smallest form factors (Android/PC focused), while ESP32-S3 devices support all platforms including iOS, enable wireless workflows (BLE/Wi‑Fi), and serve as the more general-purpose, multi-function boards.

## Get Started

<div align="center">
  <a href="https://play.google.com/store/apps/details?id=com.emwaver.app">
    <img src="docs/content/badges/google-play.png" alt="Get it on Google Play" height="52">
  </a>
  <a href="https://github.com/luispl77/emwaver/releases/latest/download/EMWaver-Android.apk">
    <img src="docs/content/badges/android-apk.png" alt="Download APK" height="52">
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

## Documentation

- Docs site: `https://luispl77.github.io/emwaver/`
- Technical reference hub: `https://luispl77.github.io/emwaver/documentation/`
- Build & reproduce hardware: `https://luispl77.github.io/emwaver/hardware-catalog/`

## License

This project is open source and available under the `LICENSE` file.
