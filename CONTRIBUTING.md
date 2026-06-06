# Contributing to EMWaver

EMWaver is an open-source, local-first electronics platform — and contributions are very welcome. Whether you're fixing a bug, improving docs, adding a script, porting to a new board, or polishing a native app, this guide will help you get started.

## Project principles

Before diving in, read these three things:

1. **[AGENTS.md](AGENTS.md)** — the repo-wide source of truth for product vision, non-negotiable policies, and the folder documentation map.
2. **[README.md](README.md)** — the public overview: what EMWaver is, platform surfaces, and the repository map.
3. **[docs/CURRENT.md](docs/CURRENT.md)** — the contributor orientation doc: current architecture, supported platforms, and doc routing.

The short version: EMWaver turns supported MCU boards into a scriptable hardware lab through native apps (iOS, Android, macOS, Windows, Linux). The core is open-source and local-first. Local hardware control must work without accounts, cloud activation, or subscription checks. Desktop MCP is hosted by the running desktop app.

## Repo layout

```text
android/                 Native Android app (Java, Gradle)
ios/                     Native iOS/iPadOS app (Swift, SwiftUI, Xcode)
macos/                   Native macOS app (Swift, SwiftUI, Xcode)
windows/                 Native Windows 11 app (WPF, C#, .NET)
linux/                   Native Linux app (Rust, GTK4/libadwaita)
apple/                   Shared Swift package used by iOS and macOS
stm/                     STM32 firmware workspace
esp/                     ESP32 firmware workspace
firmware/                Bundled firmware payloads consumed by apps
hardware/                Open hardware designs (schematics, Gerbers, BOMs)
assets/default-scripts/  Bundled example .js scripts and emw-* libraries
simulator/               Shared simulator fixtures for cross-platform testing
crates/                  Rust firmware/update helper crates
tools/                   Build and firmware support tooling
web/                     Public static website (Next.js)
docs/                    Contributor and planning docs
```

When you change a subsystem, update its folder `README.md` in the same PR. Each folder README is the authoritative source for that subsystem's architecture, build instructions, and contributor guardrails.

## Quick start for local development

### macOS app

Open `macos/EMWaver/EMWaver.xcodeproj` in Xcode and run the `EMWaver` scheme. The macOS app supports USB, BLE, and Wi-Fi transports.

### iOS app

Open `ios/EMWaver.xcodeproj` in Xcode and run the `EMWaver` scheme on a simulator or device. USB hardware testing requires a physical device.

### Android app

```bash
cd android
./gradlew assembleDebug
```

Open in Android Studio for the full IDE experience. USB host and BLE testing require a physical Android device.

### Windows app

Open `windows/EMWaver.sln` in Visual Studio 2022 (.NET desktop workload, WPF tooling). Build and run from the IDE. USB MIDI and BLE testing require a physical Windows 11 machine.

### Linux app

```bash
# Install system dependencies (Ubuntu/Debian)
sudo apt install libgtk-4-dev libadwaita-1-dev libgtksourceview-5-dev libgraphene-1.0-dev pkg-config

# Run tests (no GTK required)
cargo test --manifest-path linux/Cargo.toml --workspace --exclude emwaver-linux-app

# Run the app
cargo run --manifest-path linux/Cargo.toml -p emwaver-linux-app
```

The Linux app is under active development and not yet at feature parity with macOS. See [linux/README.md](linux/README.md) for the current status and the native transport session contract.

### STM32 firmware

The STM32 firmware workspace lives under `stm/`. Build it with STM32CubeIDE. After a firmware change, run `stm/update_firmware_bins.sh` to update the bundled payload under `firmware/emwaver.bin`.

### ESP32 firmware

The ESP32 firmware workspace lives under `esp/`. Build it with ESP-IDF. After a firmware change, copy the build artifacts so apps and tooling can find them.

### Running tests

- **Platform parity**: `node scripts/parity/verify-platform-parity.mjs` — verifies cross-platform parity contracts.
- **Simulator tests**: Each platform has a simulator bridge that runs hardware-touching `.js` scripts against `simulator/fixtures/*.json` without a physical board. Useful for CI and local iteration.
- **Linux crate tests**: `cargo test --manifest-path linux/Cargo.toml --workspace --exclude emwaver-linux-app`

## Making changes

1. **Pick an area.** Read the folder README closest to what you're changing.
2. **Sync your branch.** `git pull --rebase` before starting.
3. **Keep it focused.** One logical change per PR.
4. **Update the README.** If you change behavior in a subsystem, update that folder's `README.md` in the same PR.
5. **Update docs.** If your change affects the public website or user-facing docs, update `web/` and `docs/` as needed.
6. **Run the parity check.** `node scripts/parity/verify-platform-parity.mjs` — especially if you're adding, removing, or renaming a platform feature.
7. **Test.** Run the platform-specific tests for the subsystem you changed. For hardware-touching changes, validate on real hardware when possible.

## What makes a good contribution

- **Scripts**: well-commented, self-contained `.js` files that exercise one module or workflow clearly. See `assets/default-scripts/cc1101.js` for style.
- **Hardware support**: firmware port plus the bundled binary payload, with the board-class split preserved (STM32 DFU vs ESP32 serial flashing).
- **App improvements**: keep shared logic in the shared packages (`apple/` for iOS/macOS, `linux/crates/` for Linux). Don't duplicate behavior across platforms.
- **Docs**: clear, concise, and close to the code. Prefer folder READMEs for architecture; use `docs/` for cross-cutting planning docs.

## What we're not looking for right now

- **Reintroducing a separate browser/daemon control plane.** EMWaver is a native-app platform; desktop MCP should live in the running desktop app.
- **Cloud accounts, hosted relay, or cloud script storage.** EMWaver is local-first. Do not add account gates, cloud activation, or hosted storage to the core path.
- **Product-specific prompts or metering logic in client code.** External model routing and metering belong outside the open-source local hardware-control path.

## Need help?

- Start with the [public documentation](https://emwaver.ai/emwaver/docs).
- For architecture questions, read the folder README closest to the subsystem you're working on.
- For product direction and policies, see [AGENTS.md](AGENTS.md).
