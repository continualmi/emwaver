# EMWaver Rebirth Launch MVP

This checklist defines the minimum useful local-first EMWaver launch.

The MVP should prove:

- open-source local core,
- localhost browser Gateway,
- CLI `.emw` execution path,
- supported-board hardware flow,
- paid Agent positioning without gating hardware access.

## P0 MVP Checklist

## Local Gateway

- `gateway/` exists and is documented.
- `emwaver gateway` starts a localhost server.
- Browser opens local control UI at `127.0.0.1`.
- Local WebSocket supports browser clients plus `hello`, `script.run`, `script.started`, `script.error`, `ui.snapshot`, and `ui.event`.
- Local Gateway does not require account auth, cloud activation, subscription checks, or hosted relay.
- Native apps are self-contained and are not Gateway backends.

Backlog coverage:

- `REBIRTH-001`
- `REBIRTH-002`
- `REBIRTH-003`
- `REBIRTH-004`
- `REBIRTH-005`
- `REBIRTH-006`
- `REBIRTH-008`
- `REBIRTH-009`
- `REBIRTH-050`

## Runtime And Device

- Shared `.emw` runtime exists outside hosted/cloud control loops.
- Shared device discovery/transport layer exists.
- Gateway owns runtime/device execution for terminal/browser workflows.
- CLI uses the Gateway runtime/device layer.
- Runtime can execute scripts and emit UI snapshots.
- Device command bridge can reach connected hardware.
- Shared mock device simulator goal is defined so hardware-touching scripts can be tested without a physical board.

Backlog coverage:

- `REBIRTH-010`
- `REBIRTH-011`
- `REBIRTH-012`
- `REBIRTH-013`
- `REBIRTH-014`
- `REBIRTH-045`

## CLI

- `emwaver devices` lists local devices.
- `emwaver run path/to/script.emw` sends a script to the running localhost Gateway.
- `emwaver doctor` reports common setup/permission problems.
- SSH remote usage is documented.

Backlog coverage:

- `REBIRTH-015`
- `REBIRTH-016`
- `REBIRTH-017`
- `REBIRTH-019`

## Web Split

- Current `web/` control UI is inventoried.
- Local control UI is served by Gateway.
- Gateway UI has no sign-in or Pro gate for local hardware control.
- Cloud file/session assumptions are absent from Gateway local mode.

Backlog coverage:

- `REBIRTH-020`
- `REBIRTH-021`
- `REBIRTH-022`
- `REBIRTH-023`
- `REBIRTH-024`
- `REBIRTH-025`
- `REBIRTH-026`

## Agent

- Agent API-key flow is defined.
- Agent endpoint contract is defined.
- Private Agent instructions remain server-side.
- Native apps and the browser UI can call the Agent when a key is configured.
- Agent UI/tooling belongs in TypeScript/client code, not the Rust device backend.
- Missing Agent key does not block local hardware control.

Backlog coverage:

- `REBIRTH-027`
- `REBIRTH-028`
- `REBIRTH-029`
- `REBIRTH-030`
- `REBIRTH-031`

## Hardware Monorepo

- Hardware repository inventory exists.
- Target flat `hardware/<repo-name>/` prefixes are defined.
- The nine primary hardware repos are imported with useful history preserved.
- `hardware/README.md` documents structure and large file policy.

Backlog coverage:

- `REBIRTH-032`
- `REBIRTH-033`
- `REBIRTH-034`
- `REBIRTH-036`

## Docs

- `AGENTS.md` reflects local-first/open-source strategy.
- `README.md` points to rebirth plan and issues.
- `PLANNING.md` reflects current rebirth priorities.
- Local Gateway getting-started docs exist.
- Launch MVP checklist exists.

Backlog coverage:

- `REBIRTH-037`
- `REBIRTH-038`
- `REBIRTH-039`
- `REBIRTH-040`
- `REBIRTH-041`

## Packaging And Validation

- CLI/Gateway packaging direction is decided for macOS, Linux, and Windows.
- Local dev command exists for Gateway.
- Device access validation is documented per desktop platform.
- Device simulator work is tracked separately from real hardware validation.

Backlog coverage:

- `REBIRTH-042`
- `REBIRTH-043`
- `REBIRTH-044`
- `REBIRTH-045`

## Not Required For MVP

- Continual-hosted relay.
- Cloud file sync.
- Team/classroom management.
- Hosted remote fleet control.
- Continual-hosted native app remote control as a core cross-platform feature.
- Account-gated device activation.
- Hardware sales.

These can be optional future services if users ask for them.
