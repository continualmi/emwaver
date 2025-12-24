# Get Started

Install the apps, grab the CLI, and follow the flashing guides for your device family.

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

    [:octicons-arrow-right-24: Open Documentation](documentation/index.md)

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
