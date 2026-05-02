# EMWaver Rebirth

This document captures the product pivot for EMWaver.

EMWaver should become a lazier, simpler, open-source-first hardware scripting system with almost no cloud responsibility for core use. The product should feel like a local tool that happens to have a powerful paid AI Agent, not a cloud platform that happens to control hardware.

## 1) New Thesis

EMWaver is a local-first hardware scripting environment.

Users should be able to:

- install EMWaver,
- connect a supported board,
- open a local UI or use a CLI,
- run `.emw` scripts,
- control hardware on the same machine,
- optionally use the EMWaver Agent to write, debug, and improve scripts.

The core runtime should not require:

- a Continual MI account,
- cloud activation,
- a hosted relay,
- remote session registration,
- subscription checks,
- backend device ownership,
- cloud file sync.

The open-source core should be useful by itself.

## 2) Business Model

The core EMWaver runtime, local gateway, CLI, firmware payloads, and local script execution path should become the adoption engine.

Revenue should focus on the Agent:

- writing `.emw` scripts,
- debugging `.emw` runtime errors,
- generating hardware-specific UI controls,
- translating datasheets and module examples into working scripts,
- explaining board/module behavior,
- helping users adapt scripts across supported boards.

The paid product is not device access. The paid product is expert assistance for the EMWaver scripting environment.

## 3) Cloud Responsibility

Cloud should no longer be a launch requirement for hardware control.

Core EMWaver should work fully locally:

```text
browser or CLI
  -> localhost gateway / local runtime
  -> local transport
  -> board firmware
```

The only cloud dependency in the new direction should be the optional paid Agent API.

Remote hardware control can be documented as user-owned infrastructure:

- SSH into the machine with the board connected,
- use `emwaver` CLI commands,
- use `emwaver gateway` on localhost,
- optionally access it over VPN/Tailscale/port-forwarding at the user's own discretion.

Continual-hosted relay/control should not be part of the launch-critical open-source product.

## 4) Gateway Direction

`emwaver-web` should become the local browser control surface.

Create a new `gateway/` folder that owns the localhost runtime and control plane. It should serve the heavy `.emw` dashboard/control UI and expose local HTTP/WebSocket APIs.

Target local flow:

```bash
emwaver gateway
```

or:

```bash
emwaver web
```

Then open:

```text
http://127.0.0.1:<port>
```

The local browser UI should talk directly to the local gateway:

```text
localhost browser UI
  <-> localhost WebSocket
  <-> native EMWaver app
  <-> app-owned .emw runtime and local device transport
```

This should reuse the existing WebSocket protocol shape where practical:

- `hello`
- `script.run`
- `script.started`
- `script.error`
- `ui.snapshot`
- `ui.event`
- device status/list messages

The difference is that there is no hosted relay in the middle.

## 5) Web Split

The existing `web/` app currently mixes too many responsibilities:

- public site,
- docs/media,
- account/auth,
- subscription/billing,
- cloud dashboard,
- backend APIs,
- WebSocket relay,
- Agent routes,
- hardware control UI.

The rebirth direction should gradually separate these:

```text
gateway/
  localhost hardware control server
  local WebSocket protocol
  local native-app WebSocket bridge
  serves the control UI

web/
  public website
  docs
  downloads
  Agent marketing/account surface
  optional hosted Agent API entrypoint
```

Move the heavy `.emw` script dashboard/control experience into `gateway/` over time.

Gradually remove from the local gateway path:

- cloud auth,
- account-required flows,
- subscription checks,
- device activation gates,
- remote host heartbeat,
- cloud host/session discovery,
- cloud file assumptions.

## 6) Runtime And CLI Direction

The runtime should be factored so both CLI and gateway can use it.

Target shape:

```text
emwaver-runtime
  .emw execution
  script bootstrap
  UI tree/state machine
  callback dispatch
  device command bridge

emwaver-device
  device discovery
  USB MIDI/SysEx transport
  future transport adapters

gateway/
  localhost HTTP/WebSocket server
  browser control UI
  native app bridge

daemon/
  optional long-running host/service mode

cli/
  devices/run/web/gateway/doctor commands
```

The CLI should eventually support:

```bash
emwaver devices
emwaver run path/to/script.emw
emwaver web
emwaver gateway
emwaver doctor
```

The daemon remains useful for always-on hosts, but it should not be required for ordinary local script execution.

## 7) Agent Direction

Phase two is to make the Agent the main paid product.

The Agent should be accessed through a simple API key connected to a Continual MI backend endpoint.

The backend should own and protect:

- the Agent system prompt,
- `.emw` language instructions,
- board/runtime rules,
- module-specific guidance,
- product policy,
- usage metering.

The client should send user intent, relevant script context, selected board/module metadata, and runtime errors. The server should apply the private Agent instructions and return useful `.emw` code, patches, explanations, or debugging guidance.

This keeps the open-source runtime useful while making the specialized Agent harder to clone immediately. The defensible value should be the combination of:

- `.emw` expertise,
- hardware/module recipes,
- runtime-aware debugging,
- high-quality examples,
- fast updates to Agent instructions,
- tight integration with the local gateway and CLI.

Prompt secrecy alone should not be treated as the moat. The moat is the maintained Agent service and its practical usefulness.

## 8) Hardware Monorepo Direction

EMWaver should become a single open-source monorepo for the software, firmware, gateway, scripts, and hardware designs that make up the platform.

Hardware repositories should be merged into this repo under a dedicated `hardware/` folder, not scattered at the repo root.

Target shape:

```text
hardware/
  emwaver-air/
  emwaver-carrier/
  emwaver-core/
  emwaver-link/
  emwaver-shield/
  gpio-waver/
  infrared-waver/
  ism-waver/
  rfid-waver/
```

The purpose is to make EMWaver feel like one complete open platform:

- users can inspect the hardware,
- contributors can understand board/module capabilities,
- scripts can live near the hardware they exercise,
- firmware/app support can reference canonical hardware definitions,
- the project is easier to trust as open-source infrastructure.

Hardware imports should preserve git history where practical. Prefer history-preserving imports such as `git subtree` or a `git filter-repo` based migration into stable flat prefixes like:

```text
hardware/<repo-name>/
```

Rules for the merged hardware tree:

- keep all hardware design assets under `hardware/`,
- keep app/runtime/platform source in the existing platform folders,
- keep bundled app-consumed firmware payloads under `firmware/`,
- keep board/module manufacturing details inside the relevant hardware subfolder,
- avoid top-level clutter from imported repo roots,
- curate large generated outputs carefully,
- use Git LFS only if large binary assets become unavoidable.

This consolidation should support the local-first open-source pivot, but it should not block the gateway/CLI/runtime work.

## 9) Phases

## Phase 1: Local-First Gateway

- Create `gateway/`.
- Make localhost hardware control work without cloud.
- Reuse the existing WebSocket protocol where possible.
- Serve the `.emw` dashboard/control UI locally.
- Add a CLI entrypoint that starts the gateway.
- Keep the path account-free and activation-free.

## Phase 2: Runtime Extraction

- Extract reusable runtime/device pieces from the current daemon host.
- Make CLI and daemon share reusable `.emw` runtime/device code where useful.
- Keep gateway as a browser-to-native-app bridge rather than a second runtime.
- Add `emwaver run`.
- Add `emwaver devices`.
- Add `emwaver doctor`.

## Phase 3: Cloud Removal From Core

- Remove cloud auth assumptions from local control.
- Remove cloud activation gates from core runtime.
- Remove subscription checks from hardware access.
- Keep any hosted service code outside the local gateway path.

## Phase 4: Paid Agent

- Add API-key based Agent access.
- Keep prompts and specialized instructions server-side.
- Integrate Agent into the local browser UI.
- Integrate Agent into the CLI.
- Meter Agent usage through Continual MI.

## Phase 5: Hardware Monorepo Import

- Inventory the existing EMWaver hardware repositories.
- Confirm the final flat `hardware/<repo-name>/` prefixes.
- Import one hardware repo first as a trial.
- Preserve history with `git subtree` or equivalent.
- Add local READMEs where needed so each imported hardware folder is understandable in place.
- Update product docs and scripts to reference the new in-repo hardware paths.

## Phase 6: Optional Hosted Services

Only add hosted relay, sync, teams, classrooms, or remote fleet behavior if users clearly ask for it.

These should remain optional services layered on top of a useful local open-source core.

## 10) Product Language

Use language like:

- local-first,
- open-source core,
- localhost gateway,
- hardware scripting,
- `.emw` runtime,
- Agent-assisted scripting,
- optional paid Agent.

Avoid centering:

- cloud platform,
- device activation,
- subscription-gated hardware,
- remote relay as the main product,
- account-first onboarding.

## 11) Launch Story

The new launch story is:

> EMWaver is an open-source local hardware scripting environment. Run `.emw` scripts against real boards from a CLI or localhost browser UI. When you want help, the paid EMWaver Agent writes and debugs hardware scripts with you.

This is simpler, easier to trust, easier to adopt, and less operationally heavy than launching as a cloud hardware platform.
