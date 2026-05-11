# EMWaver

<p align="center">
  <a href="https://continualmi.com">
    <img src="https://continualmi.com/continuous-logo.png" alt="Continual MI logo" width="220">
  </a>
</p>

<p align="center">
  <strong>Local-first, open-source electronics scripting by Continual MI.</strong>
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

EMWaver turns supported MCU boards into a scriptable hardware lab. It is built around local apps, local scripts, managed firmware, and an optional Agent workflow for writing and debugging `.emw` scripts.

The core hardware-control path is open and local-first: no EMWaver account, no cloud activation, no hosted relay, no subscription check, and no cloud script storage requirement.

## What EMWaver Is

- A script-first electronics platform for running `.emw` scripts against real hardware.
- A managed multi-transport runtime where USB is first-class, with BLE and Wi-Fi available for board classes designed around them.
- Native client surfaces for Android, iOS, macOS, and Windows.
- A software-first platform where users bring a supported board and EMWaver manages the runtime and firmware setup where practical.
- A Continual MI project with optional paid Agent API usage as the business model, not paid local hardware access.

## What EMWaver Is Not

- Not a cloud-gated hardware platform.
- Not an account-required local runtime.
- Not a hosted remote-control relay for open-source core use.
- Not a workflow that expects end users to build and flash firmware manually for normal operation.
- Not dependent on EMWaver hardware sales. Third-party supported boards are first-class.

## Repository Map

```text
android/                 Android app
apple/                   Shared Swift package used by iOS and macOS
ios/                     iPhone and iPad app
macos/                   macOS app
windows/                 Windows 11 app
stm/                     STM32 firmware workspace
esp/                     ESP32 firmware workspace
firmware/                Bundled firmware payloads consumed by apps
hardware/                Imported hardware design repositories
assets/default-scripts/  Bundled example .emw scripts
simulator/               Mock and virtual transport direction
videos/                  Video planning and launch media notes
```

Public website pages and static EMWaver media live in the sibling Continual MI site repository under `../society/app/emwaver` and `../society/public/emwaver`.

## Getting Started

For end users:

1. Choose a supported board from the [hardware catalog](https://continualmi.com/emwaver/build).
2. Install the app for your platform from the [install page](https://continualmi.com/emwaver/install) or use the direct preview downloads:
   - [Android APK](https://continualmi.com/emwaver/downloads/EMWaver-android.apk)
   - [macOS DMG](https://continualmi.com/emwaver/downloads/EMWaver-macos.dmg)
   - [Windows ZIP with `EMWaver.exe`](https://continualmi.com/emwaver/downloads/EMWaver-windows-x64.zip)
3. Open the [documentation](https://continualmi.com/emwaver/docs) and run local `.emw` scripts.

App Store, Google Play, and Microsoft Store listings are coming soon.

For local development:

```bash
git clone https://github.com/continualmi/emwaver.git
cd emwaver
```

Then use the README for the subsystem you are changing:

- [android/README.md](android/README.md), [ios/README.md](ios/README.md), [macos/README.md](macos/README.md), or [windows/README.md](windows/README.md) for app-specific work.
- [stm/README.md](stm/README.md) and [esp/README.md](esp/README.md) for firmware work.
- [hardware/README.md](hardware/README.md) for imported hardware repositories.

## Local-First Runtime

The target local flow is:

```text
native app
  -> local runtime
  -> local transport
  -> supported board firmware
```

## Agent Direction

EMWaver's Agent is optional. It should help users write, explain, debug, and improve `.emw` scripts using local script/device/UI/error context when the user chooses to ask for help.

Agent usage is the planned paid product direction through a future Continual MI/MGPT backend API key. Local hardware control must continue to work without that key.

Production Agent prompts, hidden board recipes, provider routing, and metering policy do not belong in this open-source repository.

## Release Trackers

- [REBIRTH.md](docs/REBIRTH.md) captures the local-first open-source product pivot.
- [LAUNCH_MVP.md](docs/LAUNCH_MVP.md) defines the minimum launch checklist.
- [REBIRTH_ISSUES.md](docs/REBIRTH_ISSUES.md) tracks the durable rebirth backlog.
- [REBIRTH_AUDIT.md](docs/REBIRTH_AUDIT.md) audits completion and remaining gaps.
- [TESTS_REBIRTH.md](docs/TESTS_REBIRTH.md) tracks validation.
- [UI_SNAPSHOT_RUNTIME_MIGRATION.md](docs/UI_SNAPSHOT_RUNTIME_MIGRATION.md) controls the removal of script-visible logging in favor of UI snapshots/events.
- [ESP32_WIFI_TRANSPORT_AUDIT.md](docs/ESP32_WIFI_TRANSPORT_AUDIT.md) audits implementation evidence and remaining hardware gates for the ESP32 Wi-Fi transport plan.
- [ESP32_WIFI_REMOTE_ACCESS.md](docs/ESP32_WIFI_REMOTE_ACCESS.md) documents user-owned LAN/VPN access for ESP32 Wi-Fi transport.
- [AGENT_API.md](docs/AGENT_API.md) defines the optional paid Agent API boundary.
- [AGENTS.md](AGENTS.md) is the repository-wide source of truth for product vision, platform constraints, and contribution guardrails.

## Contributing

Keep changes focused and local-first. When behavior changes, update the relevant folder README in the same change. Do not add account gates, cloud activation, hosted relay dependency, subscription checks, device ownership checks, cloud script sync, or backend policy to core local hardware access.

Before opening work, read [AGENTS.md](AGENTS.md) and the README closest to the subsystem you are touching.

## License

EMWaver is licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for copyright attribution.
