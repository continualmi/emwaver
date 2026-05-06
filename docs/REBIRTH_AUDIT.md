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
| Runtime extraction | `daemon/emwaver-runtime/` owns `Engine`, `UiNode`, and `CommandBridge`; the CLI consumes it through direct local execution | done for CLI/daemon reuse |
| Device transport extraction | `daemon/emwaver-device/` owns USB MIDI/SysEx `Device`, ESP32 BLE `BleDevice`, selected input connection, EMWaver BLE service discovery, and protocol helpers | API/build done; selected-device and BLE flag error paths verified by build/help; hardware validation pending |
| Shared device simulator | `SIMULATOR.md`, `simulator/fixtures/basic-board.json`, `simulator/VIRTUAL_TRANSPORT.md`, `emwaver-runtime::SimulatorCommandBridge`, Apple `SimulatorScriptDevice`, Windows `SimulatorCommandBridge`, Android `SimulatorScriptDeviceBridge`, `REBIRTH-045` through `REBIRTH-049` | shared fixture plus Rust, Apple, Windows, and Android adapters added; virtual MIDI/USB evaluated and kept out of the portable baseline |
| `emwaver run` | `daemon/emwaver/src/main.rs` reads a `.emw` file and sends `script.run` to the localhost gateway/native-app/daemon bridge by default; `--direct` runs the extracted Rust runtime | gateway/macOS app integration passed; gateway/headless daemon simulator integration passed; direct UI-only runtime passed; hardware-backed direct validation pending |
| `emwaver doctor` | `daemon/emwaver/src/main.rs` checks platform, local state paths, autostart status, gateway package, Node/npm, Rust, and MIDI device visibility | build verified; command passed |
| `emwaver devices` through shared layer | CLI calls `emwaver_device::list_devices()` | done |
| `emwaver gateway` CLI wrapper | source edited in `daemon/emwaver/src/main.rs`; installs gateway dependencies with `npm ci` when needed, builds gateway assets when missing, and starts the built gateway with Node | built gateway smoke verified |
| `emwaver start` CLI stack | `daemon/emwaver/src/main.rs` starts the daemon host in the background, then starts the gateway in the foreground, and stops the daemon it created when the gateway exits | build verified; split gateway + `daemon serve --sim-device` WebSocket smoke passed; macOS BLE gateway smoke passed; `emwaver start --sim-device` lifecycle smoke passed; full Linux validation pending |
| Linux user service | `daemon/emwaver/src/main.rs` implements `emwaver service install|uninstall|start|stop|status`; `daemon/install/install.sh` can install the service from a development checkout | build/help verified on macOS; shell syntax verified; real Linux systemd user-service validation pending |
| Daemon as gateway runtime owner | `daemon/emwaver/src/main.rs` implements `daemon serve` as local `role=host`: handles `script.run`, `script.stop`, `ui.event`, emits `device.status`, `script.started`, `script.stopped`, `script.error`, and `ui.snapshot`; supports USB MIDI/SysEx by default and ESP32 BLE with `--ble` | simulator-backed gateway smoke passed, including UI event dispatch and updated snapshot; USB/BLE build passed; macOS BLE hardware gateway smoke passed with ESP32; Linux hardware validation pending |
| Gateway controls native app | `gateway/src/server.ts` accepts `web` and `app`/`host` WebSocket roles; macOS and Windows host services connect to localhost gateway as `role=app`; gateway forwards control to the local native app instead of using a third-party core service | macOS gateway integration passed for UI-only script; Windows build blocked by missing local dotnet/Windows toolchain; real hardware validation pending |
| Local runtime account/activation gate | macOS `ContentView` passes connected USB device to `ScriptsRootView` without claimed-device cache membership; Windows `ScriptsPage` uses `AppServices.Device` directly | macOS build passed; Windows source reviewed, build blocked by missing Windows toolchain |
| Native remote-control scope | `REBIRTH.md`, `REBIRTH-050`, `LAUNCH_MVP.md`, macOS/Windows/iOS/Android host-control code | same-machine localhost gateway control is now the core posture; native hosted relay/directory code has been removed from the primary app surfaces; macOS Debug build passed, Android Java compile passed, iOS simulator build passed, Windows build blocked by missing `dotnet` |
| Hardware repo inventory | `hardware/IMPORT_INVENTORY.md` | done |
| Hardware import script | `hardware/import-subtrees.sh` | done |
| Trial hardware import | `hardware/gpio-waver/` imported with history in `4f45903a` and flattened afterward | done |
| Full hardware import | all nine primary hardware repos imported under flat `hardware/<repo-name>/` paths | done |
| AGENTS source of truth updated | `AGENTS.md` | done |
| README/planning updated | `README.md`, `README.txt`, `PLANNING.md` | done |
| Launch MVP defined | `LAUNCH_MVP.md` | done |
| Packaging direction defined | `PACKAGING.md` | done |
| Rebirth validation tracker | `TESTS_REBIRTH.md` | done |
| Gateway CI | `.github/workflows/gateway-ci.yml` | done |
| Daemon/runtime CI | `.github/workflows/daemon-ci.yml`, `scripts/rebirth-gateway-daemon-sim-validation.sh` | hosted Ubuntu validates runtime/device tests, CLI build, UI-only direct run, simulator-backed direct run, and built gateway-to-daemon simulator render/event flow |
| Install smoke CI | `scripts/rebirth-install-smoke.sh`, `.github/workflows/daemon-ci.yml` | hosted Ubuntu validates development install prefix, installed CLI, packaged gateway assets under `share/emwaver/gateway`, and installed `emwaver gateway` health endpoint |
| Rust toolchain preflight | `scripts/check-rust-toolchain.sh` | done |
| Hardware validation helper | `scripts/rebirth-hardware-validation.sh` | tool passes UI-only path and now includes simulator-backed direct runtime; real hardware skipped until `EMWAVER_DEVICE_ID` and board are available |
| Linux validation runbook | `scripts/rebirth-linux-validation.sh` | added; execution on real Linux host with ALSA MIDI and hardware still pending |
| Windows validation runbook | `scripts/rebirth-windows-validation.ps1` | added; execution blocked until Windows workstation with .NET/WinUI SDK and hardware |
| Hosted platform validation CI | `.github/workflows/rebirth-platform-validation.yml`, `windows/EMWaver.Tests` | added hosted Ubuntu dry-run validation, hosted Windows restore/build plus simulator script-engine tests, and dispatch-only self-hosted hardware jobs |

## Verification Evidence

Recent verified commands:

```bash
cd gateway
npm ci
npm run verify

cd daemon
cargo test -p emwaver-device -p emwaver-runtime
cargo build -p emwaver
cargo run -q -p emwaver -- daemon start --help
cargo run -q -p emwaver -- devices
cargo run -q -p emwaver -- doctor
cargo run -q -p emwaver -- run <temp>.emw --direct --no-device
cargo run -q -p emwaver -- agent "write blink"
EMWAVER_AGENT_API_KEY=test-agent-key EMWAVER_AGENT_ENDPOINT=http://127.0.0.1:<mock>/agent cargo run -q -p emwaver -- agent --script <temp>.emw --mode debug "debug this"
scripts/rebirth-hardware-validation.sh
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
- selected-device direct runtime CLI help,
- `emwaver doctor`,
- `emwaver run --direct --no-device` through the extracted Rust runtime,
- direct `emwaver run` script-error reporting,
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
- local WebSocket script run to Rust daemon-produced UI snapshot with `--sim-device`.
- local WebSocket UI event dispatch through Rust daemon and updated UI snapshot with `--sim-device`.
- `scripts/rebirth-gateway-daemon-sim-validation.sh` starts the built gateway plus daemon `--sim-device`, drives `/v1/ws` as a browser client, renders a script, dispatches a UI event, and receives the updated snapshot.
- Rust daemon BLE transport builds with the shared `emwaver-device` protocol envelope and `btleplug` scan/connect/notify/write path.
- Rust daemon BLE scan saw a powered ESP32 as `EMWaver`.
- `cargo run -q -p emwaver -- run ../assets/default-scripts/blink.emw --direct --ble` rendered the Blink UI snapshot through real BLE.
- Gateway + `cargo run -q -p emwaver -- daemon serve --port 3921 --ble` rendered `blink.emw` through the localhost gateway and real BLE transport.
- `emwaver service install --help` verifies Linux service CLI surface builds.
- `bash -n daemon/install/install.sh scripts/rebirth-linux-validation.sh` verifies installer/runbook shell syntax.
- local verifier coverage is also wired into `.github/workflows/gateway-ci.yml`.
- daemon/runtime verifier coverage is wired into `.github/workflows/daemon-ci.yml`.

It does not verify:

- real hardware access,
- native app hardware-backed runtime integration,
- Linux daemon hardware-backed gateway runtime integration,
- Linux daemon ESP32 BLE runtime validation against a real board,
- Linux systemd user-service install/start validation on a real Linux host,
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
cargo build -p emwaver
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
- Validate Linux `emwaver start --device <id>` gateway/daemon script execution on real hardware.
- Validate Linux `emwaver start --ble` gateway/daemon script execution on real ESP32 BLE hardware.
- Validate local hardware script execution on at least one supported board.

Do not mark the active goal complete until those items are implemented and verified.
