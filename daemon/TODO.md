# Headless host daemon TODO

## MVP

- [x] Implementation language/runtime: **Rust**.
- [ ] Implement host presence (heartbeat) compatible with backend `/v1/hosts/heartbeat`.
- [ ] Implement backend WebSocket attach compatible with `/v1/ws`.
- [ ] Implement protocol subset:
  - [ ] `hello` (role=host)
  - [ ] `host.attach`
  - [ ] `script.run` / `script.started` / `script.error`
  - [ ] `ui.snapshot` streaming on tree changes
  - [ ] `ui.event` dispatch to handler tokens
- [ ] USB transport on macOS (cross-platform MIDI SysEx) for EMWaver device.
- [ ] USB transport on Linux (cross-platform MIDI SysEx) for EMWaver device.

## Packaging

- [ ] `emwaver` CLI (single entrypoint)
- [ ] `emwaver daemon start|stop|status`
- [ ] macOS `launchd` service definition
- [ ] Linux `systemd` service unit + `install.sh` single-command installer
- [ ] TUI pairing/login flow (device-code / browser OAuth)
