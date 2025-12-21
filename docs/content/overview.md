# Master **Hardware**, **Firmware**, **Software**.

<div style="margin-bottom: 2em;">
  <h2>Welcome to EMWaver!</h2>
  <p>Your all-in-one platform for wireless experimentation, device control, and embedded development.</p>
  <p>
    Explore the tabs above to learn more, review the firmware update process, or visit the store.
  </p>
</div>

EMWaver combines an ESP32-S3 platform with mobile and cloud tooling for wireless experimentation, signal analysis, and remote control. The ecosystem centers on Wavelets—portable JavaScript bundles that present UI through the EMWaver DSL and orchestrate hardware features without custom firmware builds.

## Download EMWaver

Get started with EMWaver by downloading the app for your platform or installing the CLI tool.

### Mobile Apps

<div class="emw-store-badges">
  <a href="https://play.google.com/store/apps/details?id=com.emwaver.app" target="_blank" rel="noopener">
    <img src="../badges/google-play.png" alt="Get it on Google Play">
  </a>
  <a href="https://apps.apple.com/app/emwaver" target="_blank" rel="noopener">
    <img src="../badges/app-store.png" alt="Download on the App Store">
  </a>
</div>

### Desktop App

<div class="emw-platform-buttons">
  <a class="emw-platform-button emw-platform-button--windows" href="https://github.com/emwaver/emwaver/releases/latest/download/EMWaver-Windows.exe" target="_blank" rel="noopener">
    <img src="../logos/windows.svg" alt="Windows">
    <span>Download for Windows</span>
  </a>
  <a class="emw-platform-button emw-platform-button--macos" href="https://github.com/emwaver/emwaver/releases/latest/download/EMWaver-macOS.dmg" target="_blank" rel="noopener">
    <img src="../logos/apple.svg" alt="macOS">
    <span>Download for macOS</span>
  </a>
  <a class="emw-platform-button emw-platform-button--linux" href="https://github.com/emwaver/emwaver/releases/latest/download/EMWaver-Linux.AppImage" target="_blank" rel="noopener">
    <img src="../logos/ubuntu.svg" alt="Linux">
    <span>Download for Linux</span>
  </a>
</div>

### Command Line Interface

Install the EMWaver CLI tool with a single command:

```bash
curl -fsSL https://raw.githubusercontent.com/luispl77/emwaver/main/cli/install.sh | sh
```

The installer automatically detects your platform (macOS, Linux, or Windows) and installs the appropriate binary.

<div class="grid cards" markdown>

-   :material-chip:{ .lg .middle } **Hardware**

    ---

    ESP32-S3 board components and specifications

    [:octicons-arrow-right-24: Go to Hardware](hardware.md)

-   :material-cog:{ .lg .middle } **Firmware**

    ---

    ESP-IDF firmware architecture and modules

    [:octicons-arrow-right-24: Go to Firmware](#firmware)

-   :material-script-text-outline:{ .lg .middle } **Wavelets**

    ---

    High-level scripting and UI bundles for EMWaver

    [:octicons-arrow-right-24: Learn about Wavelets](wavelets.md)

-   :material-xml:{ .lg .middle } **EMWaver DSL**

    ---

    Declarative UI language powering the runtime

    [:octicons-arrow-right-24: Explore the DSL](emwaver-dsl.md)

</div>

## What is EMWaver?

EMWaver is designed for enthusiasts, makers, and researchers who want to:
- Experiment with sub-GHz signals
- Build and share custom workflows through Wavelets
- Manage firmware safely without recompiling for every use case
- Expand with GPIO accessories and automation scripts

## Application Overview

The mobile application is structured around five primary fragments, each focused on a key workflow:

1. **Home** – Manage connections to the EMWaver device, view device health, and access quick actions for recent wavelets or captures.
2. **ISM** – Inspect and configure sub-GHz radio settings, including modulation parameters, channel presets, and regulatory constraints.
3. **Sampler** – Capture and analyze RF signals, visualize waveforms, and prepare recordings for replay or wavelet integration.
4. **Wavelets** – Edit, organize, and sync JavaScript bundles that render UI via the EMWaver DSL.
5. **Agents** – Chat with the EMWaver LLM assistant for troubleshooting, documentation lookups, and live wavelet debugging. The agent can review console output, propose fixes, and help author new scripts.

For guidance on authoring scripts, see the [Wavelets](wavelets.md) and [EMWaver DSL](emwaver-dsl.md) pages.

## Project Structure

- **Hardware:** ESP32-S3 board with CC1101, USB-C, and GPIO expansion
- **Firmware:** ESP-IDF-based, exposes BLE APIs consumed by the mobile runtime
- **Wavelets & DSL:** JavaScript runtime and declarative UI layer shared across platforms
- **Documentation:** MkDocs site collecting guides for hardware, firmware, and runtime features

---

## Hardware

The EMWaver board combines the ESP32-S3 with sub-GHz (CC1101) radio, USB-C for power and flashing, and general-purpose I/O. Expansion headers support custom add-ons for experimentation and automation projects. See the [Hardware](hardware.md) page for a complete component breakdown.

---

## Firmware

Firmware lives in `main/` and is built with ESP-IDF. Core modules include BLE communication (`ble_server.c`), sub-GHz drivers (`cc1101.c`), RFID support (`mfrc522.c`), and optional BadUSB features. The firmware exposes consistent APIs so Wavelets can orchestrate hardware behavior through higher-level abstractions.

---

## Documentation

This site consolidates quickstarts, tooling references, and runtime guides. Explore the dedicated pages for firmware builds, Wavelets authoring, and the EMWaver DSL to dive deeper into each layer of the platform.
