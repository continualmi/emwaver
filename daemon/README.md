# EMWaver Host Daemon (Headless) — Beta

Goal: a **cross-platform** headless host you run from the terminal (starting with **macOS**), where the EMWaver device is plugged into the machine over USB, and a remote controller (web/macOS/Windows/iOS/Android) attaches to that host.

This ships as a daemon + CLI with a single entrypoint: `emwaver …`.

## Architectural decision (Model 1)

- The daemon runs the **script runtime + UI state machine headlessly** (no GUI).
- It streams `ui.snapshot` updates and accepts `ui.event` inputs from the controller.
- The controller renders the UI and forwards user interactions as `ui.event`.
- The daemon owns the USB connection to the device.

This mirrors the existing remote-host protocol used by the desktop apps; the daemon simply does not present UI.

## Distribution constraints

We still want a **store-only** distribution model for end-user apps, but the daemon is a terminal/service component.

Target UX:
- `emwaver login` for sign-in (device-code / browser-based OAuth).
- `emwaver daemon start|stop|status` for service control.
- Runs as a background service:
  - macOS: `launchd`
  - Linux: `systemd`
- Good headless UX for secure connection + secure updates.

Status: beta / experimental.
