# Rebirth Completion Audit

This audit tracks the active objective: do the EMWaver rebirth work captured in `REBIRTH.md` and `REBIRTH_ISSUES.md`.

The objective is not complete yet.

## Success Criteria

The rebirth is complete only when:

- local gateway is a real account-free browser control surface for the native app,
- shared `.emw` runtime/device layers are extracted and verified,
- CLI can run `.emw` scripts locally,
- local gateway bridges directly to the native app over localhost WebSocket,
- local hardware control has no cloud/auth/subscription gate,
- paid Agent API-key flow works from gateway and CLI,
- hardware monorepo imports are completed under `hardware/`,
- docs and validation prove the above.

## Prompt-To-Artifact Checklist

| Requirement | Artifact/Evidence | Status |
| --- | --- | --- |
| Create rebirth plan | `REBIRTH.md` | done |
| Create issue backlog | `REBIRTH_ISSUES.md` | done |
| Local gateway folder | `gateway/README.md`, `gateway/package.json`, `gateway/src/server.ts` | done |
| Localhost browser UI | `gateway/src/server.ts` serves three-pane UI | prototype done |
| Bundled script loading | `/v1/examples` reads `assets/default-scripts/*.emw` | done |
| Local WebSocket protocol | `/v1/ws` supports `hello`, `script.run`, `script.stop`, `ui.event`, `ui.snapshot` | prototype done |
| Gateway account-free | no sign-in/token required by gateway; verified by `npm run verify` | done |
| Gateway cloud-free | no hosted relay/session discovery required by gateway | done |
| Gateway Agent panel | `gateway/src/server.ts` Agent panel and `/v1/agent` proxy | done |
| Agent missing-key behavior | `gateway/scripts/verify.mjs` checks `agent_not_configured` | done |
| Agent configured forwarding | `gateway/scripts/verify.mjs` checks mock endpoint forwarding and auth header | done |
| Runtime extraction | `daemon/RUNTIME_EXTRACTION.md` plan only | incomplete |
| Device transport extraction | `daemon/RUNTIME_EXTRACTION.md` plan only | incomplete |
| `emwaver run` | not implemented | incomplete |
| `emwaver devices` through shared layer | existing CLI still uses direct MIDI listing | incomplete |
| `emwaver gateway` CLI wrapper | source edited in `daemon/emwaver/src/main.rs`; cannot build without Cargo | unverified |
| Gateway bridges to native app | `gateway/src/server.ts` accepts `web` and `app`/`host` WebSocket roles and relays messages | prototype done |
| Hardware repo inventory | `hardware/IMPORT_INVENTORY.md` | done |
| Hardware import script | `hardware/import-subtrees.sh` | done |
| Trial hardware import | not run; requires clean worktree and creates merge commits | incomplete |
| Full hardware import | not run | incomplete |
| AGENTS source of truth updated | `AGENTS.md` | done |
| README/planning updated | `README.txt`, `PLANNING.md` | done |
| Launch MVP defined | `LAUNCH_MVP.md` | done |
| Packaging direction defined | `PACKAGING.md` | done |
| Rebirth validation tracker | `TESTS_REBIRTH.md` | done |
| Gateway CI | `.github/workflows/gateway-ci.yml` | done |
| Rust toolchain preflight | `scripts/check-rust-toolchain.sh` | blocked as expected on current machine |

## Verification Evidence

Current verified command:

```bash
cd gateway
npm ci
npm run verify
```

Latest result:

```text
gateway verify passed: hello.ack, device.status, script.started, ui.snapshot, ui.event.ack
gateway agent proxy verify passed
```

This verifies:

- TypeScript typecheck,
- gateway `/health`,
- gateway `/v1/examples` loading canonical default scripts,
- missing Agent config response,
- configured mock Agent forwarding,
- local WebSocket script run to app-produced UI snapshot,
- local WebSocket UI event forwarding to mock native app.
- local verifier coverage is also wired into `.github/workflows/gateway-ci.yml`.

It does not verify:

- real hardware access,
- native app runtime integration,
- Rust CLI build,
- `emwaver run`,
- hardware subtree imports.

## Blockers

## Rust Toolchain

The current shell does not expose:

```bash
cargo
rustc
```

Preflight script:

```bash
./scripts/check-rust-toolchain.sh
```

That blocks safe implementation/verification of:

- `emwaver-runtime` for CLI/daemon reuse,
- `emwaver-device` for CLI/daemon reuse,
- `emwaver run`,
- Rust CLI `emwaver gateway` wrapper,
- daemon refactor.

## Hardware Imports

`git subtree add` creates merge commits. The import script intentionally refuses to run in a dirty worktree.

Before running imports:

1. commit or stash current rebirth work,
2. run `./hardware/import-subtrees.sh gpio-waver`,
3. inspect history and tree shape,
4. run full import if trial is acceptable.

## Remaining P0 Work

- Build/verify Rust runtime extraction.
- Build/verify shared device transport layer.
- Implement `emwaver run`.
- Wire native macOS/Windows app to the local gateway WebSocket.
- Run trial hardware import.
- Validate local hardware script execution on at least one supported board.

Do not mark the active goal complete until those items are implemented and verified.
