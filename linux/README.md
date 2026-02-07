# Linux (Headless Host) — Beta

Goal: support portable setups (e.g. Raspberry Pi) where the EMWaver device is plugged into a Linux machine over USB, and a remote controller (web/macOS/Windows/iOS/Android) attaches to that host.

## Architectural decision (Model 1)

- Linux runs the **script runtime + UI state machine headlessly** (no GUI).
- Linux streams `ui.snapshot` updates and accepts `ui.event` inputs from the controller.
- The controller renders the UI and forwards user interactions as `ui.event`.
- The Linux host owns the USB connection to the device.

This mirrors the existing remote-host protocol used by the desktop apps; Linux simply does not present UI.

## Distribution constraints

Linux has no app stores in our distribution model.

Target UX:
- **Single-command install** (e.g. `curl ... | sh`).
- Runs as a background service (likely `systemd`).
- Provides a good headless sign-in / pairing flow (TUI + device-code / browser-based OAuth) so the host can authenticate and appear as an attachable host session.

Status: beta / experimental.
