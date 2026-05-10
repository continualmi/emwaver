# EMWaver Packaging Direction

This document supports `REBIRTH-042`.

EMWaver packages a local-first Gateway CLI for desktop/server terminal and browser workflows. Mobile platforms keep native app distribution, and desktop apps remain native self-contained applications.

## Preview App Release Workflows

GitHub Actions can publish direct-download preview builds for app testing while store distribution is still coming soon.

Current workflows:

- `.github/workflows/android-apk-release.yml` builds `EMWaver-android.apk` on Ubuntu with Gradle.
- `.github/workflows/android-play-release.yml` builds a signed Android App Bundle and uploads it to Google Play through Fastlane.
- `.github/workflows/macos-dmg-release.yml` builds the macOS app on a macOS runner and packages `EMWaver-macos.dmg`.
- `.github/workflows/cli-gateway-release.yml` builds CLI/Gateway tarballs, currently `EMWaver-linux-x64.tar.gz` and `EMWaver-macos-cli.tar.gz`.
- `.github/workflows/windows-exe-release.yml` publishes the Windows x64 app installer and portable ZIP.
- iOS distribution is automated locally through `scripts/ios-release.sh` and `ios/fastlane/`, with TestFlight automation available after App Store secrets are configured.

Stable preview asset names:

```text
EMWaver-android.apk
EMWaver-linux-x64.tar.gz
EMWaver-macos-cli.tar.gz
EMWaver-macos.dmg
EMWaverSetup-windows-x64.exe
EMWaver-windows-x64.zip
```

The EMWaver repository is private, so GitHub Release asset URLs are not public install links. Public preview files are mirrored into the Society static site under `public/emwaver/downloads/`.

## Gateway CLI Packages

The CLI/Gateway package should contain:

```text
EMWaver-<platform>/
  bin/emwaver
  share/emwaver/gateway/
  share/emwaver/assets/default-scripts/
```

The user-facing contract is:

```bash
emwaver gateway serve
emwaver gateway serve --sim-device
emwaver gateway serve --no-device
emwaver gateway serve --device 0
emwaver gateway serve --ble
emwaver gateway serve --wifi 192.168.1.44 --wifi-port 3922
emwaver run scripts/blink.emw
emwaver devices
emwaver doctor
```

`emwaver run` requires a running Gateway and sends `script.run` over localhost WebSocket. It does not provide an in-process/direct runtime mode.

Development install:

```bash
gateway/backend/install/install.sh
EMWAVER_INSTALL_SERVICE=1 EMWAVER_SERVICE_ARGS="--ble" gateway/backend/install/install.sh
```

The installer builds and installs the Rust CLI into `$HOME/.local/bin`, installs frontend assets, and can install a user-level `emwaver-gateway.service`.

## macOS

Primary user-facing options:

- direct preview DMG for the native app,
- CLI/Gateway package for local development and SSH/VPN-style workflows.

The macOS native app is self-contained and does not act as a Gateway backend. The CLI/Gateway package is a separate terminal/browser workflow.

## Linux

Primary direction:

- headless/CLI/Gateway-first,
- SSH-friendly,
- no Linux GUI app.

Linux packaging candidates:

- tarball containing `emwaver` and Gateway assets,
- Debian package later,
- systemd user unit for optional persistent Gateway startup,
- development install through repo checkout first.

Linux docs must cover device permissions for USB/MIDI/serial access once the shared transport layer is finalized.

## Windows

Primary direction:

- Windows native app remains the main end-user surface,
- CLI/Gateway package can exist for developers and technical users.

Windows packaging candidates:

- signed installer EXE as the main desktop install path,
- ZIP with `EMWaver.exe` as an alternate portable path,
- CLI/Gateway tarball later if the Rust path is validated on Windows,
- winget later.

Windows validation must cover USB/MIDI transport visibility and permissions.

## Gateway Assets

Development frontend build:

```bash
cd gateway/frontend
npm ci
npm run build
```

Gateway runtime:

```bash
cd gateway/backend
cargo run -p emwaver -- gateway serve --sim-device
```

Release packaging should not require a full source checkout. It should ship the compiled CLI plus built Gateway frontend assets.

## Non-Goals

- Do not make hosted cloud deployment part of local CLI/Gateway packaging.
- Do not require account sign-in for package install or local control.
- Do not make GitHub Releases the primary app-store replacement for end-user native apps.
- Do not add native app Gateway-host behavior back into desktop app packages.
