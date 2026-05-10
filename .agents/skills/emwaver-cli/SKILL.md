---
name: emwaver-cli
description: Use when working on EMWaver Gateway CLI usage, including device probing, gateway lifecycle, script execution, transport selection, and local install/service flows.
---

# EMWaver CLI

Use this skill for work under [`/Users/luisml/continualmi/emwaver/gateway/backend`](/Users/luisml/continualmi/emwaver/gateway/backend) and [`/Users/luisml/continualmi/emwaver/emwaver.sh`](/Users/luisml/continualmi/emwaver/emwaver.sh).

## Read first

1. [`/Users/luisml/continualmi/emwaver/gateway/backend/README.md`](/Users/luisml/continualmi/emwaver/gateway/backend/README.md)
2. [`/Users/luisml/continualmi/emwaver/gateway/README.md`](/Users/luisml/continualmi/emwaver/gateway/README.md)
3. [`/Users/luisml/continualmi/emwaver/gateway/MIGRATION.md`](/Users/luisml/continualmi/emwaver/gateway/MIGRATION.md)
4. [`/Users/luisml/continualmi/emwaver/AGENTS.md`](/Users/luisml/continualmi/emwaver/AGENTS.md)

## Where things live

- [`/Users/luisml/continualmi/emwaver/gateway/backend/emwaver/src/main.rs`](/Users/luisml/continualmi/emwaver/gateway/backend/emwaver/src/main.rs): CLI command tree (`gateway`, `devices`, `doctor`, `run`, `wifi`, `settings`, `device`, `transport`, `service`)
- [`/Users/luisml/continualmi/emwaver/gateway/backend/emwaver-device/src`](/Users/luisml/continualmi/emwaver/gateway/backend/emwaver-device/src): USB MIDI/SysEx, BLE, and Wi-Fi device probing/transport helpers
- [`/Users/luisml/continualmi/emwaver/gateway/backend/emwaver-runtime/src`](/Users/luisml/continualmi/emwaver/gateway/backend/emwaver-runtime/src): `.emw` runtime and simulator bridge used by Gateway/CLI flows
- [`/Users/luisml/continualmi/emwaver/gateway/backend/install`](/Users/luisml/continualmi/emwaver/gateway/backend/install): install/service packaging helpers
- [`/Users/luisml/continualmi/emwaver/emwaver.sh`](/Users/luisml/continualmi/emwaver/emwaver.sh): source-checkout helper for local dev runs and `emwaver` install

## Core behaviors to preserve

- The CLI is Gateway-oriented: `emw run` requires a running Gateway and should not reintroduce direct/local runtime mode.
- Local hardware control must remain account-free and local-first (no activation, hosted relay, or subscription gate).
- Keep command semantics aligned with migration decisions in `gateway/MIGRATION.md`; do not revive removed command groups/flags.
- Keep binary naming stable: `emwaver` is primary, `emw` is a shortcut alias when installed.
- Device listing/probing must stay non-invasive when Gateway is running (use Gateway-owned cached state instead of competing probe sessions).
- Keep transport selection and persisted target settings coherent across `settings`, `device`, and `transport` commands.

## Common task routing

- Command parsing/help/flags change: [`/Users/luisml/continualmi/emwaver/gateway/backend/emwaver/src/main.rs`](/Users/luisml/continualmi/emwaver/gateway/backend/emwaver/src/main.rs)
- Device probe output issue (`devices`, `doctor`, Wi-Fi checks): [`/Users/luisml/continualmi/emwaver/gateway/backend/emwaver/src/main.rs`](/Users/luisml/continualmi/emwaver/gateway/backend/emwaver/src/main.rs), [`/Users/luisml/continualmi/emwaver/gateway/backend/emwaver-device/src`](/Users/luisml/continualmi/emwaver/gateway/backend/emwaver-device/src)
- Gateway lifecycle behavior (`gateway serve|start|stop|status`): [`/Users/luisml/continualmi/emwaver/gateway/backend/emwaver/src/main.rs`](/Users/luisml/continualmi/emwaver/gateway/backend/emwaver/src/main.rs)
- Installer/dev helper behavior: [`/Users/luisml/continualmi/emwaver/emwaver.sh`](/Users/luisml/continualmi/emwaver/emwaver.sh), [`/Users/luisml/continualmi/emwaver/gateway/backend/install`](/Users/luisml/continualmi/emwaver/gateway/backend/install)

## Validation posture

- Prefer backend-local checks from [`/Users/luisml/continualmi/emwaver/gateway/backend/README.md`](/Users/luisml/continualmi/emwaver/gateway/backend/README.md): `cargo build -p emwaver` and `cargo test -p emwaver-runtime -p emwaver-device`.
- For command/UX changes, verify `emwaver --help` and affected subcommand help/output.
- Physical USB/BLE/Wi-Fi probe validation requires real hardware and should be called out when not executed.
