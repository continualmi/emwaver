---
name: emwaver-daemon-cli
description: Use when you need to operate EMWaver devices via the CLI daemon (persistent connection), send ASCII commands (SPI/CC1101/etc.), and run buffer/sampler/retransmit workflows.
---

# EMWaver Daemon + CLI (Personal Notes)

This is a “vibe hacking” cheat-sheet for using the **daemon-backed** CLI flow: connect once, then run lots of commands quickly and reliably.

## Install / Update Local Binary

```bash
cd cli
cargo install --path . --bin emwaver --force --locked
```

## Daemon Flow (Recommended)

```bash
emwaver start
emwaver status
emwaver list
emwaver connect
emwaver cmd version
```

If you need to stop it:

```bash
emwaver stop
```

## Socket Overrides

- Default chosen automatically per OS.
- Override with `EMWAVER_DAEMON_SOCKET=/path/to/emwaver.sock`
- Or pass `--socket /path/to/emwaver.sock` to daemon/buffer/sampler/retransmit commands.

## Send Commands

```bash
emwaver cmd "gpio read --pin=4"
emwaver cmd --packets 0 "gpio write --pin=4 --level=1"
emwaver cmd --json "cc1101 read --reg=0x31"
```

Firmware parsing notes:

- Prefer `--key=value` (e.g. `--cs=14`, `--reg=0x31`).
- `--packets N` controls how many 64-byte packets to read back (default `1`).

## Interactive Shell (Uses Daemon)

```bash
emwaver shell
emwaver shell --verbose
```

## Quick CC1101 VERSION Read (CS=GPIO14)

```bash
emwaver connect
emwaver cmd "cc1101 init --cs=14"
emwaver cmd "cc1101 read --reg=0x31"
```

## Buffer / Sampler / Retransmit

```bash
emwaver buffer len
emwaver buffer clear
emwaver buffer save ./capture.raw
emwaver buffer load ./capture.raw
emwaver buffer transmit

emwaver sampler start --pin 4 --duration-ms 2000
emwaver sampler stop

emwaver retransmit start --pin 5 --duration-ms 1000
emwaver retransmit stop
```
