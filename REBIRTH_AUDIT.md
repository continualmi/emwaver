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
| Localhost browser UI | `gateway/src/server.ts` serves examples, editor, browser-local open/save, bundled-script UI nodes, SVG plot rendering, Agent, protocol log, and local native-app/device status | local control parity done; browser polish still separate |
| Bundled script loading | `/v1/examples` reads `assets/default-scripts/*.emw` | done |
| Local WebSocket protocol | `/v1/ws` supports `hello`, `script.run`, `script.stop`, `ui.event`, `ui.snapshot`, `plot.viewport`, and `plot.data` relay | prototype done |
| Gateway account-free | no sign-in/token required by gateway; verified by `npm run verify` | done |
| Gateway cloud-free | no hosted relay/session discovery required by gateway | done |
| Gateway Agent panel | `gateway/src/server.ts` Agent panel and `/v1/agent` proxy | done |
| Agent missing-key behavior | `gateway/scripts/verify.mjs` checks `agent_not_configured` | done |
| Agent configured forwarding | `gateway/scripts/verify.mjs` checks mock endpoint forwarding and auth header | done |
| Agent CLI | `daemon/emwaver/src/main.rs` adds `emwaver agent` using `EMWAVER_AGENT_API_KEY` and endpoint env | missing-key and configured mock paths passed |
| Runtime extraction | `daemon/emwaver-runtime/` owns `Engine`, `UiNode`, and `CommandBridge`; `emwaver-host` consumes it through a device adapter | done for CLI/daemon reuse |
| Device transport extraction | `daemon/emwaver-device/` owns MIDI/SysEx `Device`, selected input connection, and protocol helpers; `emwaver-host` consumes it | API/build done; hardware validation pending |
| `emwaver run` | `daemon/emwaver/src/main.rs` reads a `.emw` file and sends `script.run` to the localhost gateway/native-app bridge by default; `--direct` runs the extracted Rust runtime | gateway/macOS app integration passed; direct UI-only runtime passed; hardware-backed direct validation pending |
| `emwaver doctor` | `daemon/emwaver/src/main.rs` checks platform, local state paths, autostart status, gateway package, Node/npm, Rust, and MIDI device visibility | build verified; command passed |
| `emwaver devices` through shared layer | CLI calls `emwaver_device::list_devices()` | done |
| `emwaver gateway` CLI wrapper | source edited in `daemon/emwaver/src/main.rs`; installs gateway dependencies with `npm ci` when needed and starts localhost gateway | smoke verified |
| Gateway controls native app | `gateway/src/server.ts` accepts `web` and `app`/`host` WebSocket roles; macOS and Windows host services connect to localhost gateway as `role=app`; gateway forwards control to the local native app instead of using a third-party core service | macOS gateway integration passed for UI-only script; Windows build blocked by missing local dotnet/Windows toolchain; real hardware validation pending |
| Hardware repo inventory | `hardware/IMPORT_INVENTORY.md` | done |
| Hardware import script | `hardware/import-subtrees.sh` | done |
| Trial hardware import | `hardware/gpio-waver/` imported with history in `4f45903a` and flattened afterward | done |
| Full hardware import | all nine primary hardware repos imported under flat `hardware/<repo-name>/` paths | done |
| AGENTS source of truth updated | `AGENTS.md` | done |
| README/planning updated | `README.txt`, `PLANNING.md` | done |
| Launch MVP defined | `LAUNCH_MVP.md` | done |
| Packaging direction defined | `PACKAGING.md` | done |
| Rebirth validation tracker | `TESTS_REBIRTH.md` | done |
| Gateway CI | `.github/workflows/gateway-ci.yml` | done |
| Rust toolchain preflight | `scripts/check-rust-toolchain.sh` | done |

## Verification Evidence

Recent verified commands:

```bash
cd gateway
npm ci
npm run verify

cd daemon
cargo test -p emwaver-device -p emwaver-runtime
cargo build -p emwaver-host -p emwaver
cargo run -q -p emwaver -- daemon start --help
cargo run -q -p emwaver -- devices
cargo run -q -p emwaver -- doctor
cargo run -q -p emwaver -- run <temp>.emw --direct --no-device
cargo run -q -p emwaver -- agent "write blink"
EMWAVER_AGENT_API_KEY=test-agent-key EMWAVER_AGENT_ENDPOINT=http://127.0.0.1:<mock>/agent cargo run -q -p emwaver -- agent --script <temp>.emw --mode debug "debug this"
```

Latest result:

```text
gateway verify passed: hello.ack, device.status, script.started, ui.snapshot, plot.data, ui.event.ack
gateway agent proxy verify passed
```

This verifies:

- TypeScript typecheck,
- macOS Debug app build,
- macOS local gateway app-role integration for a UI-only `.emw` script,
- Rust daemon workspace build,
- initial `emwaver-runtime` and `emwaver-device` crate extraction,
- runtime render, packet bridge, script error, UI callback dispatch, and unknown-handler tests,
- selected-device daemon startup CLI help,
- `emwaver doctor`,
- `emwaver run --direct --no-device` through the extracted Rust runtime,
- `emwaver run` against local gateway plus built macOS app,
- `emwaver gateway --port` clean-checkout dependency install/start smoke,
- gateway `/health`,
- gateway index guard for local Open/Save/native-app/Agent UI and no hosted auth/cloud file route markers,
- gateway `/v1/examples` loading canonical default scripts,
- gateway local native-app/device status UI,
- gateway browser-local `.emw` open/save controls,
- missing Agent config response,
- configured mock Agent forwarding,
- CLI Agent missing-key and configured mock behavior,
- local WebSocket script run to app-produced UI snapshot,
- local WebSocket UI event forwarding to mock native app.
- local verifier coverage is also wired into `.github/workflows/gateway-ci.yml`.

It does not verify:

- real hardware access,
- native app hardware-backed runtime integration,
- Windows app build,
- selected-device hardware behavior.

## Blockers

## Rust Toolchain

The Rust toolchain was installed with Homebrew and now passes preflight:

```bash
./scripts/check-rust-toolchain.sh
```

Verified build:

```bash
cd daemon
cargo build -p emwaver-host -p emwaver
```

Remaining Rust-side work:

- daemon refactor.

## Hardware Imports

`git subtree add` creates merge commits. The import script intentionally refuses to run in a dirty worktree.

Completed imports:

- `hardware/emwaver-air/`
- `hardware/emwaver-carrier/`
- `hardware/emwaver-core/`
- `hardware/emwaver-link/`
- `hardware/emwaver-shield/`
- `hardware/gpio-waver/`
- `hardware/infrared-waver/`
- `hardware/ism-waver/`
- `hardware/rfid-waver/`

## Remaining P0 Work

- Verify Windows app local gateway WebSocket on a Windows 11 workstation.
- Validate macOS local gateway script execution on real hardware.
- Validate local hardware script execution on at least one supported board.

Do not mark the active goal complete until those items are implemented and verified.
