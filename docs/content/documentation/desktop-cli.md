# Desktop + CLI

EMWaver uses a **single device owner** model:

- The **Desktop app** owns the USB MIDI connection and runs hardware commands and scripts.
- The **CLI** is a helper client that asks the Desktop app to perform actions.

This avoids multi-process USB contention and removes the need for a separate background daemon/service.

## Requirements

- Desktop app running
- Device connected from the Desktop UI

If the Desktop app is not running, CLI commands that require hardware access will fail with a message asking you to open the Desktop app.

## Installing the CLI (developer)

- `cargo install --path app/cli --bin emwaver --force`

## How the CLI talks to Desktop

The CLI and Desktop app communicate through a local RPC channel:

- On macOS/Linux: a Unix domain socket
- On Windows: a named pipe

Requests and responses are JSON messages sent over the local channel (no network required).
