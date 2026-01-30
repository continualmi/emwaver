# Desktop + CLI (Legacy / Internal)

EMWaver does **not** ship a CLI. Any CLI tooling in this repo is **internal/dev-only**.

EMWaver uses a **single device owner** model:

- The **app** owns the USB MIDI connection and runs hardware commands and scripts.
- The **CLI** (internal) is a helper client that asks the app to perform actions.

This avoids multi-process USB contention and removes the need for a separate background daemon/service.

## Requirements (internal)

- Desktop app running
- Device connected from the Desktop UI

If the Desktop app is not running, CLI commands that require hardware access will fail with a message asking you to open the Desktop app.

## Installing the CLI (internal)

- `cargo install --path app/cli --bin emwaver --force`

## How the CLI talks to the app

The CLI and Desktop app communicate through a local RPC channel:

- On macOS: a Unix domain socket
- On Windows: a named pipe

Requests and responses are JSON messages sent over the local channel (no network required).
