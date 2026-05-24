# EMWaver

<p align="center">
  <a href="https://continualmi.com">
    <img src="https://continualmi.com/continuous-logo.png" alt="Continual MI logo" width="220">
  </a>
</p>

<p align="center">
  <strong>Zero-compile electronics scripting for phones, desktops, and supported MCU boards.</strong>
</p>

<p align="center">
  <a href="https://continualmi.com/emwaver">Website</a> ·
  <a href="https://continualmi.com/emwaver/docs">Documentation</a> ·
  <a href="https://continualmi.com/emwaver/install">Install</a> ·
  <a href="https://continualmi.com/emwaver/build">Supported hardware</a> ·
  <a href="https://continualmi.com">Continual MI</a>
</p>

<p align="center">
  <img src="https://continualmi.com/emwaver/banner.jpeg" alt="EMWaver running across phone, desktop, and supported boards" width="860">
</p>

EMWaver turns supported MCU boards into a scriptable hardware lab. Write JavaScript, press run, and talk to real electronics from native apps without rebuilding firmware for every experiment.

The core runtime is local-first: scripts run on your device, hardware access does not require an EMWaver account, and supported boards are controlled through local transports such as USB, BLE, and Wi-Fi.

> Status: EMWaver is in an early open-source platform release. The architecture is working across the native apps, while packaging, documentation, supported-board coverage, and installer polish are still improving.

## Why EMWaver

Embedded development often means setting up toolchains, compiling firmware, flashing boards, and repeating that loop for every small hardware experiment. EMWaver moves the iteration loop into local scripts:

```js
// Example direction: script against a connected device immediately.
const id = await spi.transfer([0x80 | 0x30, 0x00]);
console.log("device id", id);
```

Use EMWaver when you want to:

- explore sensors, radios, GPIO, SPI, I2C, ADC, and board peripherals quickly;
- run repeatable hardware scripts from a phone, tablet, or desktop;
- control hardware directly from native apps;
- use native apps instead of asking every user to install an MCU toolchain;
- bring AI assistance into hardware scripting while keeping the local runtime useful on its own.

## What Works Today

EMWaver currently includes native app work for:

- Android
- iOS / iPadOS
- macOS
- Windows
- Linux, in progress

The platform is designed around:

- local JavaScript scripts (`.js`);
- managed board firmware;
- USB as a first-class transport;
- BLE and Wi-Fi for board classes that support them;
- STM32 and ESP32-family firmware targets;
- shared example scripts under [`assets/default-scripts/`](assets/default-scripts/).

A current cross-platform validation path is `cc1101.js`, which exercises register-level reads and writes against a CC1101 radio through supported hardware.

## Repository Map

```text
android/                 Android app
ios/                     iPhone and iPad app
macos/                   macOS app
windows/                 Windows 11 app
linux/                   Linux app port, in progress
apple/                   Shared Swift package used by iOS and macOS
stm/                     STM32 firmware workspace
esp/                     ESP32 firmware workspace
firmware/                Bundled firmware payloads consumed by apps
assets/default-scripts/  Bundled example .js scripts and emw-* libraries
simulator/               Shared simulator and protocol fixtures
hardware/                Imported hardware design repositories
crates/                  Rust firmware/update helper crates
tools/                   Build and firmware support tooling
videos/                  Video planning and launch media notes
web/                     Static website sources and exports
```

## Getting Started

For users:

1. Choose a supported board from the [hardware catalog](https://continualmi.com/emwaver/build).
2. Install an app from the [install page](https://continualmi.com/emwaver/install), or use a preview download when available:
   - [Android APK](https://continualmi.com/emwaver/downloads/EMWaver-android.apk)
   - [macOS DMG](https://continualmi.com/emwaver/downloads/EMWaver-macos.dmg)
   - [Windows ZIP with `EMWaver.exe`](https://continualmi.com/emwaver/downloads/EMWaver-windows-x64.zip)
3. Connect a supported board.
4. Open or write a JavaScript hardware script and run it locally.

App Store, Google Play, and Microsoft Store listings are planned.

For local development:

```bash
git clone https://github.com/continualmi/emwaver.git
cd emwaver
```

Then read the README closest to the subsystem you are changing:

- [android/README.md](android/README.md)
- [ios/README.md](ios/README.md)
- [macos/README.md](macos/README.md)
- [windows/README.md](windows/README.md)
- [stm/README.md](stm/README.md)
- [esp/README.md](esp/README.md)
- [hardware/README.md](hardware/README.md)

## Local-First Design

EMWaver's normal hardware-control path is:

```text
native app
  -> local script runtime
  -> local transport
  -> supported board firmware
  -> electronics
```

Core hardware control is designed to work without cloud activation, hosted device ownership checks, cloud script storage, or an account-required runtime.

Remote access, when needed, should be user-owned: local network, SSH, VPN, Tailscale, or similar tools around the local app/runtime.

## Agent Assistance

EMWaver is built to work well with an optional Agent that can help write, explain, debug, and improve hardware scripts. The local scripting and hardware-control path remains useful without Agent assistance.

Agent features may use an API key and network access when enabled by the user. Scripts and device control remain local by default.

## Documentation

Start here:

- [docs/CURRENT.md](docs/CURRENT.md) — current repository orientation
- [docs/TESTS.md](docs/TESTS.md) — active hardware validation notes
- [docs/SIMULATOR.md](docs/SIMULATOR.md) — simulator direction
- [docs/AGENT_API.md](docs/AGENT_API.md) — optional Agent API boundary
- [docs/ESP32_WIFI_TRANSPORT_PLAN.md](docs/ESP32_WIFI_TRANSPORT_PLAN.md) — ESP32 Wi-Fi transport plan
- [docs/parity/](docs/parity/) — cross-platform parity contracts
- [AGENTS.md](AGENTS.md) — repository-wide contributor guidance

## Contributing

EMWaver is open source and local-first. Contributions should preserve these principles:

- local scripts should run without account sign-in;
- local hardware access should not require cloud activation or subscription checks;
- scripts should stay local by default;
- normal users should not need to build or flash firmware manually for everyday scripting;
- behavior changes should update the relevant README or documentation file.

Before larger changes, read [AGENTS.md](AGENTS.md) and the README for the subsystem you are touching.

## License

EMWaver is licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for copyright attribution.
