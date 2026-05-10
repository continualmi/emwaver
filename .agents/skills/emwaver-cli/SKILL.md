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

## CLI invocation policy

- Always run commands with `emw` first in examples and real executions; treat it as the canonical entrypoint (the command we expect to behave like running the local `cargo run -p emwaver -- ...` flow).
- If `emw` fails because of command resolution/path issues (`command not found`, not executable, missing shim/symlink), immediately retry the same command via `./emwaver.sh ...`.
- After a path-resolution failure, apply a one-time path fix so later commands keep using `emw`:
  - `./emwaver.sh install --prefix ~/.local --force`
  - `export PATH="$HOME/.local/bin:$PATH"`
- Keep command semantics identical between `emw` and the dev fallback (`./emwaver.sh`) so troubleshooting reflects installed-user behavior.

### How `emw` mapping works today

- **Installed path (repo-defined):** installers create `emw` as a link to `emwaver`.
  - `emwaver.sh install` runs `cargo install ... emwaver` and then `ln -sf emwaver "$prefix/bin/emw"`.
  - `gateway/backend/install/install.sh` copies the release `emwaver` binary and then `ln -sf emwaver "$BIN_DIR/emw"`.
- **Dev fallback behavior (repo-defined):** `./emwaver.sh <args>` builds and executes `gateway/backend/target/debug/emwaver` directly with the same args.
- **Current machine mapping (observed):** `emw` resolves to `~/.local/bin/emw`, which is a small shell wrapper that executes `/Users/luisml/continualmi/emwaver/gateway/backend/dev "$@"`; that `dev` helper builds and runs `target/debug/emwaver`.
- **Why this works:** every path (`emw` symlink, local wrapper, and `./emwaver.sh`) ultimately runs the same CLI entrypoint binary (`emwaver`), so subcommands like `emw devices` and the dev equivalent stay behaviorally aligned.

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
