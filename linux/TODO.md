# Linux headless host TODO

## MVP

- [ ] Decide implementation language/runtime (Rust / .NET / Node) aligned with existing client runtimes.
- [ ] Implement host presence (heartbeat) compatible with backend `/v1/hosts/heartbeat`.
- [ ] Implement backend WebSocket attach compatible with `/v1/ws`.
- [ ] Implement protocol subset:
  - [ ] `hello` (role=host)
  - [ ] `host.attach`
  - [ ] `script.run` / `script.started` / `script.error`
  - [ ] `ui.snapshot` streaming on tree changes
  - [ ] `ui.event` dispatch to handler tokens
- [ ] USB transport on Linux for EMWaver device.

## Packaging

- [ ] `emwaver-host` binary
- [ ] `install.sh` single-command installer
- [ ] `systemd` service unit
- [ ] TUI pairing flow (device-code / browser OAuth)
