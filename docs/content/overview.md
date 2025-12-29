# Get Started

Install the apps, grab the CLI, and follow the flashing guides for your device family.

EMWaver is a fully open-source, offline-first hardware hacking and development platform — designed to be a more powerful and cost-effective alternative to platforms like Flipper Zero and Arduino by treating your phone and PC as part of the “device”.

Instead of cramming everything into firmware, EMWaver devices connect directly over BLE or USB and lean on the resources you already have (CPU, memory, storage, UI). That lets you build workflows that are hard or impossible with firmware alone: richer interfaces, bigger captures, faster iteration loops, and scripted procedures that can evolve without reflashing. The ecosystem includes mobile apps, a desktop app, and the EMWaver CLI (for fast project generation and automation). EMWaver also introduces a middleware layer called Wavelets: self-contained scripts written in a JavaScript-like language (EMWaver DSL) that automate hardware workflows and render portable UI components across Android, iOS, and desktop in a consistent way.

Hardware comes in two platform families: STM32 devices are ultra low-cost, USB-only, and optimized for the smallest form factors (Android/PC focused), while ESP32-S3 devices support all platforms including iOS, enable wireless workflows (BLE/Wi‑Fi), and serve as the more general-purpose, multi-function boards.

The current-gen hardware lineup includes 7 devices/modules (EMWaver, EMWaver Shield, EMWaver DIY, ISM Waver, Infrared Waver, RFID Waver, GPIO Waver) with capabilities like Sub‑GHz ISM radio (RFM69HW / CC1101), infrared RX + TX, GPIO expansion, USB scripting/BadUSB, RFID (RC522), and 2.4 GHz modules (NRF24L01+). Browse the hardware catalog and build guides here: https://luispl77.github.io/emwaver/hardware/

## Download The Apps

Mobile apps are the primary UI for connecting to devices and running workflows.

### Mobile Apps

<div class="emw-store-badges">
  <a href="https://play.google.com/store/apps/details?id=com.emwaver.app" target="_blank" rel="noopener">
    <img src="../badges/google-play.png" alt="Get it on Google Play">
  </a>
  <a href="https://github.com/luispl77/emwaver/releases/latest/download/EMWaver-Android.apk" target="_blank" rel="noopener">
    <img src="../badges/android-apk.png" alt="Download APK">
  </a>
  <a href="https://apps.apple.com/app/emwaver" target="_blank" rel="noopener">
    <img src="../badges/app-store.png" alt="Download on the App Store">
  </a>
</div>

### Desktop App

<div class="emw-platform-buttons">
  <a class="emw-platform-button emw-platform-button--windows" href="https://github.com/luispl77/emwaver/releases/latest/download/EMWaver-Windows.exe" target="_blank" rel="noopener">
    <img src="../logos/windows.svg" alt="Windows">
    <span>Download for Windows</span>
  </a>
  <a class="emw-platform-button emw-platform-button--macos" href="https://github.com/luispl77/emwaver/releases/latest/download/EMWaver-macOS.dmg" target="_blank" rel="noopener">
    <img src="../logos/apple.svg" alt="macOS">
    <span>Download for macOS</span>
  </a>
  <a class="emw-platform-button emw-platform-button--linux" href="https://github.com/luispl77/emwaver/releases/latest/download/EMWaver-Linux.AppImage" target="_blank" rel="noopener">
    <img src="../logos/ubuntu.svg" alt="Linux">
    <span>Download for Linux</span>
  </a>
</div>

## Install The CLI

Install the EMWaver CLI tool with a single command:

```bash
curl -fsSL https://raw.githubusercontent.com/luispl77/emwaver/main/cli/install.sh | sh
```

The installer automatically detects your platform (macOS, Linux, or Windows) and installs the appropriate binary.

<div class="grid cards" markdown>

-   :material-flash:{ .lg .middle } **Flash Firmware**

    ---

    Follow the step-by-step flashing guides (STM32 and ESP32).

    [:octicons-arrow-right-24: Open Flashing Guides](flashing-firmware/index.md)

-   :material-hammer-wrench:{ .lg .middle } **Build & Reproduce**

    ---

    Build the boards and 3D-printed casings from the open hardware catalog.

    [:octicons-arrow-right-24: Open Hardware Catalog Guide](hardware-catalog.md)

-   :material-book-open-variant:{ .lg .middle } **Technical Reference**

    ---

    Full project documentation: repo layout, firmware, CLI, apps, protocol.

    [:octicons-arrow-right-24: Open Documentation](documentation/buffer.md)

</div>

## Video Guides

- YouTube channel: https://www.youtube.com/@EMWavers
- STM32 flashing: https://youtu.be/vVpXeJAoiaE
- ESP32 flashing: https://youtu.be/L5RjArbZA84

## What To Do Next

- If you have an **STM32-based device** (Infrared/ISM/RFID Waver), start with **Flashing Firmware → STM32**.
- If you have an **ESP32-S3 device** (Flagship/Shield/DIY), start with **Flashing Firmware → ESP32**.
- If you want to build hardware, go to **Hardware → Build & Reproduce**.
- For deep technical details, use the **Documentation** tab.
