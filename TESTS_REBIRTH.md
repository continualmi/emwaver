# EMWaver Rebirth Validation

This file tracks validation for the local-first rebirth work.

It complements `TESTS.md`, which remains the manual hardware test suite.

## Gateway Prototype

| Test | Status | Evidence |
| --- | --- | --- |
| `gateway npm ci` | `pass` | `npm ci` completed with 0 vulnerabilities. |
| `gateway typecheck` | `pass` | `npm run typecheck` completed successfully. |
| `gateway /health` | `pass` | `GET http://127.0.0.1:3921/health` returned `{"ok":true,"service":"emwaver-gateway"}`. |
| `gateway ws script.run` | `pass` | WebSocket to `/v1/ws` returned `hello.ack`, `device.status`, `script.started`, and `ui.snapshot` for `UI.render(UI.text({ text: "hello" }))`. |
| `gateway verify` | `pass` | `npm run verify` passed after the native-app bridge update, including typecheck, `/health`, `/v1/examples`, `/v1/agent` missing-key behavior, configured mock Agent forwarding, and browser -> mock native app -> browser WebSocket `script.run` -> `ui.snapshot` plus `ui.event` -> `ui.event.ack`. |
| Gateway CI workflow | `added` | `.github/workflows/gateway-ci.yml` runs `npm ci` and `npm run verify` for gateway changes. |

## CLI

| Test | Status | Evidence |
| --- | --- | --- |
| Rust toolchain preflight | `blocked` | `./scripts/check-rust-toolchain.sh` reports missing `cargo`/`rustc` in the current shell. |
| Rust CLI build | `blocked` | Requires Rust toolchain preflight to pass first. |
| `emwaver gateway --port` | `blocked` | Requires Rust CLI build. |

## Hardware Repos

| Test | Status | Evidence |
| --- | --- | --- |
| Local hardware repo inventory | `pass` | Repos found under `/Users/luisml/Documents/emwaver/`, all git repos on `main` with `continualmi` remotes. |
| Hardware import script dirty guard | `pass` | `./hardware/import-subtrees.sh` refused to run in a dirty worktree before creating subtree commits. |
| Trial hardware import | `pass` | `./hardware/import-subtrees.sh gpio-waver` imported `gpio-waver` with history in commit `4f45903a`; the repo now lives at `hardware/gpio-waver/`. |
| Full hardware import | `pass` | `./hardware/import-subtrees.sh all` imported the remaining eight repos as subtree commits and skipped existing `hardware/gpio-waver/`. |

## Platform Device Access

| Platform | Status | Notes |
| --- | --- | --- |
| macOS | `pending` | Validate CLI/gateway shared transport after runtime/device extraction. |
| Linux | `pending` | Validate on a machine with device permissions and Cargo/toolchain installed. |
| Windows | `pending` | Validate USB/MIDI visibility through the Windows app/CLI environment. |

## Validation Rules

- Do not treat TypeScript UI preview as proof of real hardware execution.
- Do not mark `emwaver run` complete until it runs through the shared runtime/device layer.
- Do not mark local gateway hardware control complete until the gateway uses the real runtime/device bridge.
- Hardware monorepo import is complete for the nine primary repos; catalog cleanup for older/generated hardware IDs remains separate follow-up work.
