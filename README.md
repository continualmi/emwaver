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

EMWaver turns supported MCU boards into a scriptable hardware lab. Write JavaScript or JSX-style scripts, press run, and talk to real electronics from native apps without rebuilding firmware for every experiment.

The core runtime is local-first: scripts run on your device, hardware access does not require an EMWaver account, and supported boards are controlled through USB, BLE, and Wi-Fi transports. USB-C gives direct plug-in control, BLE enables cable-free mobile use, and Wi-Fi can support LAN/VPN-style remote hardware control for boards designed around it. The hardware direction is mobile-first too: compact USB-C male boards can plug directly into modern phones, tablets, and laptops for a portable lab that goes far beyond fixed-purpose handheld tools.

> Status: EMWaver is in an early open-source platform release. The architecture is working across the native apps, while packaging, documentation, supported-board coverage, and installer polish are still improving.

## Why EMWaver

Embedded development often means setting up toolchains, compiling firmware, flashing boards, and repeating that loop for every small hardware experiment. EMWaver moves the iteration loop into local scripts, closer to the speed of a software REPL than the usual edit-build-flash cycle.

Scripts can also define instant interfaces for connected modules, so a single file can probe hardware, expose controls, visualize state, and exercise the full feature set of a device:

```jsx
export default function CC1101Panel() {
  const [partnum, setPartnum] = useState("--");

  async function readPartnum() {
    const reply = await spi_transfer([0x80 | 0x30, 0x00]);
    setPartnum(`0x${reply[1].toString(16)}`);
  }

  return (
    <panel title="CC1101">
      <text>PARTNUM: {partnum}</text>
      <button onPress={readPartnum}>Read register</button>
    </panel>
  );
}
```

Use EMWaver when you want to:

- explore sensors, radios, GPIO, SPI, I2C, ADC, and board peripherals quickly;
- run repeatable hardware scripts from a phone, tablet, or desktop;
- control hardware directly from native apps;
- use native apps instead of asking every user to install an MCU toolchain;
- iterate faster than traditional Arduino-style edit-build-flash workflows;
- build instant UI panels for modules directly from scripts;
- carry a compact USB-C hardware lab that plugs directly into phones, tablets, and laptops;
- use BLE for cable-free sessions and Wi-Fi for networked or remote hardware control;
- let an Agent inspect hardware, run primitive tools, probe modules, debug failures, and help with authorized security research.

## What Works Today

EMWaver currently includes native app work for:

- Android
- iOS / iPadOS
- macOS
- Windows
- Linux, in progress

The platform is designed around:

- local JavaScript and JSX-style scripts (`.js`, `.jsx`);
- managed board firmware;
- USB as a first-class transport;
- BLE and Wi-Fi for board classes that support them;
- STM32 and ESP32-family firmware targets;
- shared example scripts under [`assets/default-scripts/`](assets/default-scripts/).

A current cross-platform validation path is `cc1101.js`, which exercises register-level reads and writes against a CC1101 radio through supported hardware.

## Hardware

EMWaver is not one fixed device. The repository includes nine hardware designs for different form factors and capabilities, from compact USB-C controllers to radio, infrared, GPIO, RFID, and ESP32-S3 wireless builds.

See the public build page for the hardware catalog:

- [emwaver.ai/emwaver/build](https://emwaver.ai/emwaver/build/)

The hardware sources live under [`hardware/`](hardware/):

- EMWaver Air — ESP32-S3 all-in-one wireless board with CC1101-class radio, IR, and expansion
- EMWaver Carrier — ESP32-S3 DevKit carrier for modular builds
- EMWaver Core — compact STM32 USB control board
- EMWaver Link — integrated STM32 USB radio board
- EMWaver Shield — ESP32-S3 shield-style prototyping board
- GPIO Waver — GPIO, SPI, UART, and I2C prototyping board
- Infrared Waver — IR capture and replay board
- ISM Waver — sub-GHz ISM / CC1101 board
- RFID Waver — 13.56 MHz RFID add-on

Each hardware folder can include schematics, PCB previews, Gerbers, BOMs, pick-and-place files, and case files where available.

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
2. Install an app from the [install page](https://continualmi.com/emwaver/install):
   - [iPhone and iPad on the App Store](https://apps.apple.com/us/app/emwaver/id6747035939)
   - Android through Google Play internal testing or the direct [Android APK](https://continualmi.com/emwaver/downloads/EMWaver-android.apk)
   - [macOS DMG](https://continualmi.com/emwaver/downloads/EMWaver-macos.dmg)
   - Windows installer or [Windows ZIP with `EMWaver.exe`](https://continualmi.com/emwaver/downloads/EMWaver-windows-x64.zip)
3. Connect a supported board.
4. Open or write a JavaScript hardware script and run it locally.

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

Wi-Fi-capable boards can also be controlled over a local network or through user-owned remote access such as VPN, Tailscale, SSH tunneling, or port forwarding.

## Agent-Ready Hardware Interface

EMWaver's Agent is more than a script-writing assistant. When enabled, it can work through the same hardware interface exposed to scripts: named primitives such as `spi_transfer`, GPIO reads/writes, analog reads, and board/module probes. That lets the Agent inspect connected hardware, test assumptions, debug wiring or protocol failures, and assist with authorized security research.

The local scripting and hardware-control path remains useful without Agent assistance. Agent features may use an API key and network access when enabled by the user. Scripts and device control remain local by default.

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
