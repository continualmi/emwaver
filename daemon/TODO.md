# Headless local runtime TODO

## MVP

- [x] Implementation language/runtime: **Rust**.
- [ ] Keep localhost gateway protocol compatibility with `/v1/ws`.
- [ ] Implement protocol subset:
  - [ ] `hello` (role=app/host for localhost gateway compatibility)
  - [ ] `host.attach`
  - [ ] `script.run` / `script.started` / `script.error`
  - [ ] `ui.snapshot` streaming on tree changes
  - [ ] `ui.event` dispatch to handler tokens
- [ ] USB transport on macOS (cross-platform MIDI SysEx) for EMWaver device.
- [ ] USB transport on Linux (cross-platform MIDI SysEx) for EMWaver device.

## Packaging

- [ ] `emwaver` CLI (single entrypoint)
- [ ] `emwaver daemon start|stop|status` local-service replacement, if still needed
- [ ] macOS `launchd` service definition (optional; for now we can run as a background child process)
- [ ] Linux `systemd` service unit + `install.sh` single-command installer
