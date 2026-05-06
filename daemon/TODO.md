# Headless local runtime TODO

## MVP

- [x] Implementation language/runtime: **Rust**.
- [x] Keep localhost gateway protocol compatibility with `/v1/ws`.
- [ ] Implement protocol subset:
  - [x] `hello` (role=app/host for localhost gateway compatibility)
  - [x] `script.run` / `script.started` / `script.error`
  - [x] `script.stop` / `script.stopped`
  - [x] `ui.snapshot` streaming after script render and UI events
  - [x] `ui.event` dispatch to handler tokens
- [ ] USB transport on macOS (cross-platform MIDI SysEx) for EMWaver device.
- [x] USB transport on Linux (cross-platform MIDI SysEx) for EMWaver device.
- [x] ESP32 BLE transport path for Linux/headless daemon.
- [ ] Hardware-validate Linux USB MIDI/SysEx transport.
- [ ] Hardware-validate Linux ESP32 BLE transport.

## Packaging

- [x] `emwaver` CLI (single entrypoint)
- [x] `emwaver daemon start|stop|status` local-service replacement, if still needed
- [ ] macOS `launchd` service definition (optional; for now we can run as a background child process)
- [ ] Linux `systemd` service unit + `install.sh` single-command installer
