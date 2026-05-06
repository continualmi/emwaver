# EMWaver Packaging Direction

This document supports `REBIRTH-042`.

The reborn EMWaver should package a local-first CLI and localhost gateway for desktop/server platforms. Mobile platforms keep native app distribution.

## Targets

## Preview app release workflows

GitHub Actions can publish direct-download preview builds for app testing while store distribution is still coming soon.

Current workflows:

- `.github/workflows/android-apk-release.yml` builds `EMWaver-android.apk` on Ubuntu with Gradle.
- `.github/workflows/android-play-release.yml` builds a signed Android App Bundle and uploads it to Google Play through Fastlane, defaulting to the internal testing track and draft release status.
- `.github/workflows/macos-dmg-release.yml` builds the macOS app on a macOS runner and packages `EMWaver-macos.dmg`.
- `.github/workflows/cli-gateway-release.yml` builds CLI/gateway tarballs, currently `EMWaver-linux-x64.tar.gz` and `EMWaver-macos-cli.tar.gz`.
- `.github/workflows/windows-exe-release.yml` publishes the Windows x64 app and packages `EMWaver-windows-x64.zip`, containing `EMWaver.exe` and its required runtime files.
- iOS distribution is automated locally through `scripts/ios-release.sh` and `ios/fastlane/`, and TestFlight upload can run through `.github/workflows/ios-testflight-release.yml` after the protected `app-store` GitHub Environment secrets are configured. Apple review submission remains a manual App Store Connect checkpoint.

Each workflow can be run manually from GitHub Actions with a release tag, defaulting to `emwaver-preview`, or by pushing a tag matching `emwaver-v*`.

Stable public preview URLs:

```text
https://continualmi.com/emwaver/downloads/EMWaver-android.apk
https://continualmi.com/emwaver/downloads/EMWaver-linux-x64.tar.gz
https://continualmi.com/emwaver/downloads/EMWaver-macos-cli.tar.gz
https://continualmi.com/emwaver/downloads/EMWaver-macos.dmg
https://continualmi.com/emwaver/downloads/EMWaver-windows-x64.zip
```

The EMWaver repository is private, so GitHub Release asset URLs are not public install links. Public preview files are mirrored into the Society static site under `public/emwaver/downloads/`.

The macOS DMG is unsigned/notarization-free until Apple signing credentials are wired into CI. The Android APK is unsigned until Play/App signing or a GitHub Actions signing secret path is added. Windows currently ships as a ZIP because a raw WinUI `.exe` is not a complete redistributable package.

## Android Play Store

Google Play distribution is handled from `android/fastlane/` and `.github/workflows/android-play-release.yml`.

Required protected GitHub Environment:

```text
play-store
```

Required GitHub secrets:

```text
ANDROID_KEYSTORE_BASE64
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
```

`ANDROID_KEYSTORE_BASE64` is the base64-encoded Android upload keystore. `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` is the full JSON key for a Google Play service account with access to the EMWaver app in Play Console.

Current setup note as of 2026-05-05:

- The `play-store` GitHub Environment has been created for `continualmi/emwaver`.
- All five required environment secrets have been added.
- A new Android upload key was generated under the local ignored `.local-secrets/android-play/` folder.
- The matching public upload certificate was submitted through Play Console's upload-key reset flow.
- Play Console shows the upload-key reset request as pending; Google activation can take roughly two days.
- Do not run the Android Play workflow until Play Console shows the new upload key is active, otherwise Google Play may reject the uploaded `.aab`.

The workflow builds `app-release.aab` and uploads to the `internal` track by default with `draft` release status, leaving rollout and production promotion as Play Console checkpoints. Manual workflow inputs can override `versionCode`, `versionName`, changelog text, and target track.

The Play Console package name must match the Android application id:

```text
com.emwaver.emwaverandroidapp
```

## macOS

Primary user-facing options:

- direct preview DMG now; App Store listing coming soon,
- CLI/gateway package for local development and SSH-style workflows.

Initial CLI packaging candidates:

- signed/notarized universal binary later,
- Homebrew tap later,
- development install through repo checkout first.

The CLI should start:

```bash
emwaver start
emwaver start --ble
emwaver gateway
emwaver gateway --daemon-fallback
emwaver daemon start
emwaver devices
emwaver run scripts/blink.emw
```

## Linux

Primary direction:

- headless/CLI/gateway-first,
- SSH-friendly,
- no Linux GUI app.

Initial packaging candidates:

- tarball containing `emwaver` and gateway assets,
- Debian package later,
- systemd unit only for optional daemon mode,
- development install through repo checkout first.

The current preview tarball is built by `.github/workflows/cli-gateway-release.yml` and contains:

```text
EMWaver-linux-x64/
  bin/emwaver
  share/emwaver/gateway/
```

This layout matches the CLI's packaged gateway lookup path, so `bin/emwaver gateway` and `bin/emwaver start --sim-device` can run without a source checkout.

The same CLI workflow also builds `EMWaver-macos-cli.tar.gz` with the same internal layout for macOS command-line use. A future Windows CLI package should join this workflow matrix once the Rust CLI/gateway path is validated on Windows.

Linux docs must cover device permissions for USB/MIDI/serial access once the shared transport layer is finalized.

The Linux user-facing contract should be one command-line tool:

```bash
emwaver start
```

This starts the local daemon host and localhost browser gateway as one stack. The browser renders the full gateway UI; the daemon owns script execution, UI event dispatch, and local hardware transport underneath. Advanced users can split the stack for SSH/systemd workflows:

```bash
emwaver service install --device 0
emwaver service install --ble
emwaver daemon start --device 0
emwaver daemon start --ble
emwaver gateway
emwaver daemon serve --sim-device
```

Release packaging must include enough gateway assets for `emwaver start` and `emwaver gateway` to work without users knowing about the internal `gateway/` package directory. Development checkout mode may still use `npm ci` and `npm run start` from `gateway/`. Linux hardware docs must also cover ALSA MIDI permissions for USB MIDI/SysEx and BlueZ/Bluetooth permissions for ESP32 BLE.

Current development installer:

```bash
./daemon/install/install.sh
EMWAVER_INSTALL_SERVICE=1 EMWAVER_SERVICE_ARGS="--ble" ./daemon/install/install.sh
```

This builds and installs the Rust CLI into `$HOME/.local/bin`, prepares gateway npm dependencies, and can install the user-level daemon service. This is not the final public installer because it still requires a source checkout, Rust, Node, and npm.

macOS can exercise the same daemon/gateway/runtime path and should be used as a fast Unix smoke target, especially for BLE. Linux still needs separate validation because the deploy surface is systemd + BlueZ + ALSA/device permissions rather than launchd/CoreBluetooth/CoreMIDI.

## Windows

Primary direction:

- Windows native app remains the main end-user surface,
- CLI/gateway should still be possible for developers and technical users.

Initial packaging candidates:

- standalone signed executable later,
- winget later,
- development install through repo checkout first.

Windows validation must cover USB/MIDI transport visibility and permissions.

## Gateway Assets

The CLI should be able to start the gateway without requiring users to know the internal `gateway/` package layout.

Development mode can call:

```bash
npm run start
```

from `gateway/`.

Current development CLI mode can call the gateway package automatically:

```bash
emwaver gateway
emwaver start
```

Release packaging should avoid requiring a full source checkout if possible. Final packaging options can include:

- bundled Node runtime,
- compiled JS gateway server plus static UI assets,
- Rust-native HTTP/WebSocket gateway after runtime extraction,
- native app-embedded gateway where appropriate.

Do not decide this too early. First make local gateway + runtime + CLI work.

## Non-Goals

- Do not make hosted cloud deployment part of local CLI/gateway packaging.
- Do not require account sign-in for package install or local control.
- Do not make GitHub Releases the primary app-store replacement for end-user native apps.
