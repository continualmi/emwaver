# EMWaver Daemon + CLI (Notes)

The EMWaver CLI includes a small **local daemon** that keeps the BLE connection alive and exposes a **local Unix socket** (JSON-RPC-ish) so multiple tools (CLI, desktop app, VS Code) can reuse the same connection.

This page documents the “connect → command → workflows” flow for day-to-day hacking.

## Requirements / Support

- The daemon is currently **Unix-only** (macOS/Linux). On non-Unix platforms, daemon commands will return “not supported”.

## Install

From this repo checkout:

```bash
cd cli
cargo install --path . --bin emwaver --force --locked
```

## Socket Location

Default socket path:

- macOS: `~/Library/Caches/emwaver/emwaver.sock`
- Linux: `~/.cache/emwaver/emwaver.sock`
- If `XDG_RUNTIME_DIR` is set: `$XDG_RUNTIME_DIR/emwaver.sock`

Override:

- Environment variable: `EMWAVER_DAEMON_SOCKET=/path/to/emwaver.sock`
- Per-command: `--socket /path/to/emwaver.sock`

## Daemon Lifecycle

Run in the foreground (useful while debugging):

```bash
emwaver daemon run
```

Start in the background:

```bash
emwaver start
```

Check status:

```bash
emwaver status
emwaver status --json
```

Stop:

```bash
emwaver stop
```

## Device Discovery + Connect

Scan for devices via the daemon:

```bash
emwaver list
emwaver list --timeout-ms 8000
emwaver list --json
```

Connect:

```bash
# Connect to the first matching device name (default name is "EMWaver")
emwaver connect

# Connect to a specific BLE address
emwaver connect --address AA:BB:CC:DD:EE:FF
```

See what the daemon thinks is connected:

```bash
emwaver connected
emwaver connected --json
```

Disconnect:

```bash
emwaver disconnect
```

## Sending Commands (ASCII)

Send one ASCII command line to the connected device:

```bash
emwaver cmd version
emwaver cmd "gpio read --pin=4"
```

Notes:

- The firmware command parser expects `--key=value` for most flags (e.g. `--cs=14`, `--reg=0x31`).
- `emwaver cmd` reads back `--packets N` **64-byte packets** (defaults to `1`). For fire-and-forget commands, pass `--packets 0`.
- Use `--json` to get `{ bytes_b64, text }` for scripting.

## Interactive Shell (Uses Daemon)

The interactive shell uses the daemon and will try to connect automatically:

```bash
emwaver shell
emwaver shell --verbose
```

## Example: Read CC1101 VERSION Register (CS=GPIO14)

The CC1101 `VERSION` register is at address `0x31` (read-only; typical value is `0x14`).

```bash
emwaver connect
emwaver cmd "cc1101 init --cs=14"
emwaver cmd "cc1101 read --reg=0x31"
```

If you want raw base64 bytes for automation:

```bash
emwaver cmd --json "cc1101 read --reg=0x31"
```

## Buffer / Sampler / Retransmit (Daemon-Managed)

These commands talk to the daemon, which owns the RX buffer and handles pacing/flow-control details.

RX buffer:

```bash
emwaver buffer len
emwaver buffer clear
emwaver buffer save ./capture.raw
emwaver buffer load ./capture.raw
emwaver buffer transmit
```

Sampler:

```bash
emwaver sampler start --pin 4 --duration-ms 2000
emwaver sampler stop
```

Retransmit (plays back whatever is in the daemon RX buffer):

```bash
emwaver retransmit start --pin 5 --duration-ms 1000
emwaver retransmit stop
```
