# EMWaver Rebirth Issue Backlog

This backlog converts `REBIRTH.md` into implementation issues.

Status values:

- `todo`
- `in progress`
- `blocked`
- `done`

Priority values:

- `P0` launch-critical foundation
- `P1` important follow-up
- `P2` optional or later

## Epic 1: Local-First Gateway

## `REBIRTH-001` Create `gateway/` Package

- Status: `done`
- Priority: `P0`
- Target: repo structure

Create the new `gateway/` folder as the owner of localhost hardware control.

Acceptance criteria:

- `gateway/README.md` explains the local-first gateway purpose.
- `gateway/` is clearly separate from hosted/cloud `web/`.
- The README defines the expected local HTTP/WebSocket responsibilities.

## `REBIRTH-002` Add Local Gateway CLI Entrypoint

- Status: `in progress`
- Priority: `P0`
- Target: CLI/daemon

Add an `emwaver gateway` or `emwaver web` command that starts a local gateway process.

Acceptance criteria:

- Command starts a localhost server.
- Command prints the local URL.
- Command supports a port override.
- Command does not require account auth or cloud config.

## `REBIRTH-003` Serve Browser Control UI From Localhost

- Status: `done`
- Priority: `P0`
- Target: gateway/web UI

Serve the heavy `.emw` control/dashboard UI from the local gateway.

Acceptance criteria:

- Browser can open the local control surface at `127.0.0.1`.
- UI loads without cloud auth.
- UI can connect to the local WebSocket endpoint.

## `REBIRTH-004` Add Local WebSocket Control Endpoint

- Status: `done`
- Priority: `P0`
- Target: gateway protocol

Add a localhost WebSocket endpoint compatible with the current control protocol shape.

Acceptance criteria:

- Endpoint accepts browser/controller connections.
- Endpoint supports `hello`.
- Endpoint supports `script.run`.
- Endpoint publishes `script.started`, `script.error`, and `ui.snapshot`.
- Endpoint accepts `ui.event`.

## `REBIRTH-005` Reuse Existing Control Messages

- Status: `done`
- Priority: `P0`
- Target: protocol compatibility

Keep the local protocol close to the existing cloud relay protocol so current control UI logic can be reused.

Acceptance criteria:

- Local protocol documents supported message names.
- Gateway code maps local messages to runtime actions.
- No hosted relay assumptions are required for local messages.

## `REBIRTH-006` Remove Cloud Session Dependencies From Gateway

- Status: `done`
- Priority: `P0`
- Target: gateway/runtime

Local gateway mode must not require hosted heartbeat, remote session discovery, or account session routing.

Acceptance criteria:

- Gateway starts without `EMWAVER_BACKEND_URL`.
- Gateway starts without `EMWAVER_ID_TOKEN`.
- Gateway does not call hosted `/v1/hosts/heartbeat`.
- Gateway does not require hosted session discovery.

## `REBIRTH-007` Add Local Device Status Messages

- Status: `in progress`
- Priority: `P1`
- Target: gateway protocol

Expose connected device status to the local browser UI.

Acceptance criteria:

- Gateway can list visible supported device ports.
- UI can display connected/disconnected state.
- Status messages are local-only and account-free.

## `REBIRTH-008` Gateway Local Port And Browser Open Behavior

- Status: `done`
- Priority: `P1`
- Target: CLI/gateway UX

Make gateway startup ergonomic.

Acceptance criteria:

- Default port is documented.
- Port override works.
- Existing port conflict is handled gracefully.
- Optional browser auto-open behavior exists or is explicitly deferred.

## `REBIRTH-009` Gateway README And Security Notes

- Status: `done`
- Priority: `P0`
- Target: docs

Document local gateway usage and security boundaries.

Acceptance criteria:

- README states gateway binds to localhost by default.
- README explains that exposing the port is user-owned risk.
- README documents SSH/VPN usage direction.

## Epic 2: Runtime Extraction

## `REBIRTH-010` Extract Reusable `.emw` Runtime

- Status: `done`
- Priority: `P0`
- Target: daemon/runtime

Extract the script runtime from `daemon/emwaver-host` so CLI, gateway, and daemon can share it.

Acceptance criteria:

- Runtime logic is available as a reusable crate/module.
- Bootstrap loading is shared.
- Script evaluation can run outside the cloud daemon loop.
- Existing daemon behavior remains compatible.

## `REBIRTH-011` Extract Reusable Device Transport Layer

- Status: `in progress`
- Priority: `P0`
- Target: daemon/device

Extract device discovery and USB MIDI/SysEx transport into reusable code.

Acceptance criteria:

- Device listing is reusable by CLI and gateway.
- Device command send/response is reusable by runtime.
- Platform-specific assumptions are documented.

## `REBIRTH-012` Make Gateway Bridge To Native App

- Status: `done`
- Priority: `P0`
- Target: gateway/native app

Gateway script execution must be forwarded to the local native EMWaver app instead of duplicating runtime/device logic.

Acceptance criteria:

- Gateway accepts a native app connection over localhost WebSocket.
- Gateway forwards `script.run` and `script.stop` from browser to native app.
- Gateway forwards `ui.event` from browser to native app.
- Gateway relays `ui.snapshot`, `script.started`, `script.stopped`, and `script.error` from native app to browser.
- Gateway still renders app-produced UI snapshots in the browser.

## `REBIRTH-013` Make Daemon Use Shared Runtime

- Status: `done`
- Priority: `P1`
- Target: daemon/runtime

Refactor daemon to depend on the shared runtime/device code.

Acceptance criteria:

- Daemon still supports existing WebSocket host mode.
- Runtime code is not duplicated between daemon and gateway.

## `REBIRTH-014` Runtime Tests For Script UI

- Status: `done`
- Priority: `P1`
- Target: tests

Add focused runtime tests for `.emw` script execution and UI snapshots.

Acceptance criteria:

- Test covers a simple `UI.render` script.
- Test covers script error reporting.
- Test can run without hardware.

## Epic 3: CLI

## `REBIRTH-015` Add `emwaver run`

- Status: `in progress`
- Priority: `P0`
- Target: CLI/runtime

Run a `.emw` script from the terminal without cloud or daemon requirements.

Acceptance criteria:

- `emwaver run path/to/script.emw` loads the script.
- Command connects to a default/local device when needed.
- Command reports script errors clearly.
- Command does not require account auth.
- Gateway/native-app controller mode is the default.
- `--direct` runs the extracted Rust runtime in-process.

## `REBIRTH-016` Add `emwaver run --device`

- Status: `todo`
- Priority: `P1`
- Target: CLI/device

Allow selecting a specific connected device.

Acceptance criteria:

- `--device <id>` selects a visible device.
- Invalid device selection returns a useful error.

## `REBIRTH-017` Add `emwaver doctor`

- Status: `in progress`
- Priority: `P1`
- Target: CLI/diagnostics

Add diagnostics for device visibility and local environment.

Acceptance criteria:

- Reports OS/platform.
- Reports visible transport ports.
- Reports local state paths.
- Reports common permission/setup problems where detectable.

## `REBIRTH-018` Decide Future Of `emwaver tui`

- Status: `todo`
- Priority: `P1`
- Target: CLI/TUI

Decide whether the TUI remains daemon status only or becomes script-aware.

Acceptance criteria:

- Decision is documented.
- Follow-up implementation issues are added if TUI becomes script-aware.

## `REBIRTH-019` Document SSH Remote Usage

- Status: `done`
- Priority: `P0`
- Target: docs

Document remote control through user-owned SSH/VPN workflows.

Acceptance criteria:

- Docs show `ssh <host>` plus `emwaver` CLI usage.
- Docs explain that EMWaver does not require hosted relay for this path.
- Docs explain security ownership when exposing localhost services.

## Epic 4: Web Split

## `REBIRTH-020` Inventory Current Control UI In `web/`

- Status: `done`
- Priority: `P0`
- Target: web/gateway

Identify which current `web/` components belong in the local control UI.

Acceptance criteria:

- Inventory lists source files and routes.
- Each item is classified as `move`, `share`, `keep in web`, or `delete later`.

## `REBIRTH-021` Move Reusable Control UI To Gateway

- Status: `in progress`
- Priority: `P0`
- Target: web/gateway

Move or share the heavy `.emw` dashboard/control pieces with `gateway/`.

Acceptance criteria:

- Gateway can render the control UI.
- Public site/docs remain in `web/`.
- Local control UI does not require hosted auth.

## `REBIRTH-022` Remove Auth Assumptions From Local Control UI

- Status: `done`
- Priority: `P0`
- Target: gateway UI

Local control UI must work without sign-in.

Acceptance criteria:

- No sign-in gate for local script execution.
- No subscription gate for local hardware access.
- Agent features can still show API-key state separately.

## `REBIRTH-023` Remove Cloud File/Session Assumptions From Local Control UI

- Status: `done`
- Priority: `P1`
- Target: gateway UI

Local control UI should not depend on hosted files, cloud sessions, or remote host discovery.

Acceptance criteria:

- Local scripts can be loaded from local examples or user files.
- Remote/cloud session widgets are absent or hidden in local mode.

## Epic 5: Cloud Removal From Core

## `REBIRTH-024` Remove Required Account From Hardware Control

- Status: `in progress`
- Priority: `P0`
- Target: product/runtime

Make account-free local hardware control an explicit product behavior.

Acceptance criteria:

- Local runtime path has no required account calls.
- Docs state local hardware control is account-free.

## `REBIRTH-025` Remove Device Activation Gate From Local Runtime

- Status: `todo`
- Priority: `P0`
- Target: runtime/product policy

Local runtime should not block hardware access on backend activation.

Acceptance criteria:

- Local device identity can exist for naming/status.
- Local script execution is not gated by backend ownership.

## `REBIRTH-026` Keep Hosted Service Code Outside Gateway Path

- Status: `done`
- Priority: `P1`
- Target: architecture

Prevent optional hosted service code from creeping back into local gateway dependencies.

Acceptance criteria:

- Gateway dependency graph is reviewed.
- Hosted auth/billing/relay modules are not required by gateway startup.

## Epic 6: Agent Product

## `REBIRTH-027` Define Agent API-Key Flow

- Status: `done`
- Priority: `P0`
- Target: Agent/API

Define how users configure a Continual MI Agent API key for EMWaver.

Acceptance criteria:

- API key storage location is documented.
- CLI and gateway can read configured key.
- Missing key has a graceful no-Agent state.

## `REBIRTH-028` Design Agent Endpoint Contract

- Status: `done`
- Priority: `P0`
- Target: Agent/API

Define request/response shape for the paid Agent endpoint.

Acceptance criteria:

- Contract includes user prompt.
- Contract includes selected board/module metadata.
- Contract includes current script context.
- Contract includes runtime errors/logs when available.
- Response supports code, explanation, and patch-style output.

## `REBIRTH-029` Keep Agent Instructions Server-Side

- Status: `done`
- Priority: `P0`
- Target: Agent/security

Ensure specialized Agent prompts and `.emw` instructions live on the Continual MI backend, not in the open client.

Acceptance criteria:

- Client sends context but not private system instructions.
- Server owns prompt assembly.
- Docs state prompt secrecy is not the only moat.

## `REBIRTH-030` Add Agent Panel To Gateway UI

- Status: `done`
- Priority: `P1`
- Target: gateway UI/Agent

Add Agent assistance to the local browser control UI.

Acceptance criteria:

- Agent panel can send current script/error context.
- Missing API key shows setup state.
- Agent responses can be copied or applied intentionally.

## `REBIRTH-031` Add Agent CLI Command

- Status: `done`
- Priority: `P1`
- Target: CLI/Agent

Expose Agent assistance from terminal workflows.

Acceptance criteria:

- CLI can send a prompt plus optional script file.
- CLI uses configured API key.
- CLI prints useful response output.

## Epic 7: Hardware Monorepo

## `REBIRTH-032` Inventory Hardware Repositories

- Status: `done`
- Priority: `P0`
- Target: hardware

Inventory all EMWaver hardware repositories that should be imported.

Acceptance criteria:

- List includes repo name, source path/remote, category, and target prefix.
- Missing repos are called out.

## `REBIRTH-033` Decide Hardware Prefixes

- Status: `done`
- Priority: `P0`
- Target: hardware

Decide final flat `hardware/<repo-name>/` paths.

Acceptance criteria:

- Prefix map is documented.
- Naming is consistent and lowercase.

## `REBIRTH-034` Import One Hardware Repo As Trial

- Status: `done`
- Priority: `P0`
- Target: hardware

Import one hardware repository with history under `hardware/`.

Acceptance criteria:

- Import preserves useful git history.
- Imported files live under one hardware prefix.
- Repo root remains clean.
- Trial documents the import command used.

## `REBIRTH-035` Import Remaining Hardware Repos

- Status: `done`
- Priority: `P1`
- Target: hardware

Import remaining board/module hardware repositories after the trial.

Acceptance criteria:

- Each imported repo has a stable hardware prefix.
- Each import preserves useful history where practical.
- Each imported folder has an in-place README or existing docs.

## `REBIRTH-036` Add `hardware/README.md`

- Status: `done`
- Priority: `P0`
- Target: docs/hardware

Add a top-level hardware index.

Acceptance criteria:

- Explains the flat hardware repo layout.
- Lists imported hardware projects.
- Documents large/generated output policy.

## Epic 8: Docs And Launch

## `REBIRTH-037` Update `AGENTS.md`

- Status: `done`
- Priority: `P0`
- Target: docs

Update repo-wide policy to reflect local-first open-source EMWaver.

Acceptance criteria:

- Product vision no longer centers cloud-first SaaS.
- Local-first gateway/CLI is documented as core.
- Paid Agent is documented as the primary revenue path.
- Hosted services are optional.

## `REBIRTH-038` Update `README.txt`

- Status: `done`
- Priority: `P0`
- Target: docs

Update root README identity and doc index.

Acceptance criteria:

- Mentions local-first open-source direction.
- Links `REBIRTH.md` and `REBIRTH_ISSUES.md`.
- Describes `gateway/`, CLI, and hardware direction when they exist.

## `REBIRTH-039` Update `PLANNING.md`

- Status: `done`
- Priority: `P0`
- Target: planning

Replace launch priorities with rebirth priorities.

Acceptance criteria:

- Current focus mentions local gateway, runtime extraction, CLI, and hardware inventory.
- Active work points to this backlog.

## `REBIRTH-040` Write Local Gateway Getting Started Docs

- Status: `done`
- Priority: `P1`
- Target: docs

Document `emwaver gateway` / `emwaver web` once available.

Acceptance criteria:

- Shows command.
- Shows localhost URL.
- Shows script run flow.
- States no account is required.

## `REBIRTH-041` Define Launch MVP Checklist

- Status: `done`
- Priority: `P0`
- Target: planning

Define the minimum launchable local-first EMWaver.

Acceptance criteria:

- Checklist covers CLI, gateway, runtime, docs, and Agent positioning.
- Each checklist item maps to one or more backlog issues.

## Epic 9: Packaging

## `REBIRTH-042` Decide CLI Packaging Targets

- Status: `done`
- Priority: `P1`
- Target: packaging

Decide packaging approach for macOS, Linux, and Windows CLI/gateway.

Acceptance criteria:

- macOS install path is documented.
- Linux install path is documented.
- Windows install path is documented.
- Packaging does not require hosted cloud services.

## `REBIRTH-043` Add Local Dev Command For Gateway

- Status: `done`
- Priority: `P1`
- Target: developer UX

Add a fast local development command for gateway work.

Acceptance criteria:

- Command starts gateway in dev mode.
- Command logs local URL.
- Command documents required environment.

## `REBIRTH-044` Platform Device Access Validation

- Status: `in progress`
- Priority: `P1`
- Target: validation

Validate local CLI/gateway device access on macOS, Linux, and Windows.

Acceptance criteria:

- macOS result is documented.
- Linux result is documented.
- Windows result is documented.
- Known permission/setup issues are captured.

## First Implementation Slice

Start with these issues:

- `REBIRTH-001` Create `gateway/` Package
- `REBIRTH-004` Add Local WebSocket Control Endpoint
- `REBIRTH-010` Extract Reusable `.emw` Runtime
- `REBIRTH-011` Extract Reusable Device Transport Layer
- `REBIRTH-015` Add `emwaver run`
- `REBIRTH-020` Inventory Current Control UI In `web/`
- `REBIRTH-024` Remove Required Account From Hardware Control
- `REBIRTH-032` Inventory Hardware Repositories

This slice reveals the architecture while avoiding premature cleanup.
