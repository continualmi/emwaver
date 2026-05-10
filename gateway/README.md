# EMWaver Gateway

The Gateway is EMWaver's local hardware-control stack for terminal and browser workflows.

The active consolidation plan is controlled by [`MIGRATION.md`](MIGRATION.md). The target layout is:

```text
gateway/
  backend/    Rust Gateway service, emwaver CLI, runtime, transports, install/service helpers
  frontend/   React browser UI, frontend build scripts, static assets
```

The intended runtime model is:

```text
CLI -> Gateway -> device
browser -> Gateway -> device
native apps -> self-contained native runtime -> device
```

Native apps keep their own local runtime, transports, firmware update flows, Wi-Fi setup, Agent UI, and native renderers. They are not Gateway backends.

## Current State

- `gateway/backend/` contains the Rust Gateway backend, CLI, runtime, and transports.
- `gateway/frontend/` contains the React browser UI package and frontend build scripts.
- `emwaver gateway serve` runs the localhost webserver and runtime owner in one process.
- `emwaver run` requires a running Gateway and sends `script.run` over localhost WebSocket.
- Device listing is UID-backed: physical devices are exposed only after the backend can read a hardware UID. While Gateway already owns a transport, browser status and `/v1/devices` report that owned device from Gateway state instead of opening competing probe sessions.

Use `MIGRATION.md` as the migration checklist until the remaining docs and validation updates are complete.

## Development Checks

```bash
cd gateway/backend
cargo build -p emwaver
cargo test -p emwaver-runtime -p emwaver-device

cd ../frontend
npm ci
npm run typecheck
npm run build
```

## Local-First Rules

- Gateway binds to localhost by default.
- Local scripts and hardware control must not require EMWaver accounts, cloud activation, hosted relay, subscription checks, or cloud script storage.
- Remote use is user-owned infrastructure around the local tool, such as SSH, VPN, Tailscale, or explicit port forwarding.
- Agent and UI tooling belong in TypeScript, not in the Rust device backend.
