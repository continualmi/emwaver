# EMWaver Rebirth Launch MVP

This checklist defines the minimum useful local-first EMWaver launch.

The MVP should prove:

- open-source local core,
- localhost browser gateway,
- CLI `.emw` execution path,
- supported-board hardware flow,
- paid Agent positioning without gating hardware access.

## P0 MVP Checklist

## Local Gateway

- `gateway/` exists and is documented.
- `emwaver gateway` starts a localhost server.
- Browser opens local control UI at `127.0.0.1`.
- Local WebSocket supports browser and native-app roles plus `hello`, `script.run`, `script.started`, `script.error`, `ui.snapshot`, and `ui.event`.
- Local gateway does not require account auth, cloud activation, subscription checks, or hosted relay.

Backlog coverage:

- `REBIRTH-001`
- `REBIRTH-002`
- `REBIRTH-003`
- `REBIRTH-004`
- `REBIRTH-005`
- `REBIRTH-006`
- `REBIRTH-008`
- `REBIRTH-009`

## Runtime And Device

- Shared `.emw` runtime exists outside cloud daemon loop.
- Shared device discovery/transport layer exists.
- Gateway bridges to the native app that owns runtime/device execution.
- CLI uses the shared runtime/device layer.
- Runtime can execute scripts and emit UI snapshots.
- Device command bridge can reach connected hardware.

Backlog coverage:

- `REBIRTH-010`
- `REBIRTH-011`
- `REBIRTH-012`
- `REBIRTH-013`
- `REBIRTH-014`

## CLI

- `emwaver devices` lists local devices.
- `emwaver run path/to/script.emw` runs a script locally.
- `emwaver doctor` reports common setup/permission problems.
- SSH remote usage is documented.

Backlog coverage:

- `REBIRTH-015`
- `REBIRTH-016`
- `REBIRTH-017`
- `REBIRTH-019`

## Web Split

- Current `web/` control UI is inventoried.
- Local control UI is moved/shared into gateway.
- Gateway UI has no sign-in or Pro gate for local hardware control.
- Cloud file/session assumptions are absent from gateway local mode.

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
- Gateway and/or CLI can call the Agent when a key is configured.
- Missing Agent key does not block local hardware control.

Backlog coverage:

- `REBIRTH-027`
- `REBIRTH-028`
- `REBIRTH-029`
- `REBIRTH-030`
- `REBIRTH-031`

## Hardware Monorepo

- Hardware repository inventory exists.
- Target `hardware/boards/*` and `hardware/modules/*` prefixes are defined.
- At least one hardware repo is imported with useful history preserved.
- `hardware/README.md` documents structure and large file policy.

Backlog coverage:

- `REBIRTH-032`
- `REBIRTH-033`
- `REBIRTH-034`
- `REBIRTH-036`

## Docs

- `AGENTS.md` reflects local-first/open-source strategy.
- `README.txt` points to rebirth plan and issues.
- `PLANNING.md` reflects current rebirth priorities.
- Local gateway getting-started docs exist.
- Launch MVP checklist exists.

Backlog coverage:

- `REBIRTH-037`
- `REBIRTH-038`
- `REBIRTH-039`
- `REBIRTH-040`
- `REBIRTH-041`

## Packaging And Validation

- CLI/gateway packaging direction is decided for macOS, Linux, and Windows.
- Local dev command exists for gateway.
- Device access validation is documented per desktop platform.

Backlog coverage:

- `REBIRTH-042`
- `REBIRTH-043`
- `REBIRTH-044`

## Not Required For MVP

- Continual-hosted relay.
- Cloud file sync.
- Team/classroom management.
- Hosted remote fleet control.
- Account-gated device activation.
- Hardware sales.

These can be optional future services if users ask for them.
