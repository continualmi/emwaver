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
- `.github/workflows/windows-exe-release.yml` publishes the Windows x64 app and packages `EMWaver-windows-x64.zip`, containing `EMWaver.exe` and its required runtime files.
- iOS distribution is automated locally through `scripts/ios-release.sh` and `ios/fastlane/`, and TestFlight upload can run through `.github/workflows/ios-testflight-release.yml` after the protected `app-store` GitHub Environment secrets are configured. Apple review submission remains a manual App Store Connect checkpoint.

Each workflow can be run manually from GitHub Actions with a release tag, defaulting to `emwaver-preview`, or by pushing a tag matching `emwaver-v*`.

Stable public preview URLs:

```text
https://continualmi.com/emwaver/downloads/EMWaver-android.apk
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
emwaver gateway
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

Linux docs must cover device permissions for USB/MIDI/serial access once the shared transport layer is finalized.

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
