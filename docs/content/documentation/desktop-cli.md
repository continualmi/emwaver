# Desktop + CLI

EMWaver uses a **single device owner** model:

- The **Desktop app** owns the USB MIDI connection and runs hardware commands and wavelets.
- The **CLI** is a helper client that asks the Desktop app to perform actions.

This avoids multi-process USB contention and removes the need for a separate background daemon/service.

## Requirements

- Desktop app running
- Device connected from the Desktop UI

If the Desktop app is not running, CLI commands that require hardware access will fail with a message asking you to open the Desktop app.

## How the CLI talks to Desktop

The CLI and Desktop app communicate through a local, file-based mailbox:

- Desktop writes a heartbeat file (`ready.json`)
- CLI writes request files to an inbox directory
- Desktop writes response files to an outbox directory

This keeps the mechanism simple and debuggable (you can inspect the JSON files on disk if needed).

