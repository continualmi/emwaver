# EMWaver Packaging Direction

This document supports `REBIRTH-042`.

The reborn EMWaver should package a local-first CLI and localhost gateway for desktop/server platforms. Mobile platforms keep native app distribution.

## Targets

## Preview app release workflows

GitHub Actions can publish direct-download preview builds for app testing while store distribution is still coming soon.

Current workflows:

- `.github/workflows/android-apk-release.yml` builds `EMWaver-android.apk` on Ubuntu with Gradle.
- `.github/workflows/macos-dmg-release.yml` builds the macOS app on a macOS runner and packages `EMWaver-macos.dmg`.
- `.github/workflows/windows-exe-release.yml` publishes the Windows x64 app and packages `EMWaver-windows-x64.zip`, containing `EMWaver.exe` and its required runtime files.

Each workflow can be run manually from GitHub Actions with a release tag, defaulting to `emwaver-preview`, or by pushing a tag matching `emwaver-v*`.

Stable public preview URLs:

```text
https://continualmi.com/emwaver/downloads/EMWaver-android.apk
https://continualmi.com/emwaver/downloads/EMWaver-macos.dmg
https://continualmi.com/emwaver/downloads/EMWaver-windows-x64.zip
```

The EMWaver repository is private, so GitHub Release asset URLs are not public install links. Public preview files are mirrored into the Society static site under `public/emwaver/downloads/`.

The macOS DMG is unsigned/notarization-free until Apple signing credentials are wired into CI. The Android APK is unsigned until Play/App signing or a GitHub Actions signing secret path is added. Windows currently ships as a ZIP because a raw WinUI `.exe` is not a complete redistributable package.

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
