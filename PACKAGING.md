# EMWaver Packaging Direction

This document supports `REBIRTH-042`.

The reborn EMWaver should package a local-first CLI and localhost gateway for desktop/server platforms. Mobile platforms keep native app distribution.

## Targets

## macOS

Primary user-facing options:

- native macOS app through the App Store,
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
