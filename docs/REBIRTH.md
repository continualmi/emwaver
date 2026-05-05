# EMWaver Rebirth

This document captures the product pivot for EMWaver.

EMWaver should become a lazier, simpler, open-source-first hardware scripting system with no EMWaver cloud responsibility for core use. The product should feel like a local tool that happens to have a powerful paid AI Agent API, not a cloud platform that happens to control hardware.

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
- an EMWaver account,
- cloud activation,
- a hosted relay,
- remote session registration,
- subscription checks,
- backend device ownership,
- hardware-UID registration,
- device minting,
- device limits,
- cloud script storage,
- cloud file sync,
- account-backed project libraries.

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

The paid product is not device access. The paid product is expert assistance for the EMWaver scripting environment, accessed through a user-provided API key to the future Continual MI/MGPT Agent backend.

## 3) Cloud Responsibility

EMWaver should not have a cloud runtime or account system in the core product.

Core EMWaver should work fully locally:

```text
browser or CLI
  -> localhost gateway / local runtime
  -> local transport
  -> board firmware
```

The only network dependency in the new direction should be the optional paid Agent API. That API should live on a focused Continual MI/MGPT backend, not on an EMWaver cloud runtime.

Remote hardware control can be documented as user-owned infrastructure:

- SSH into the machine with the board connected,
- use `emwaver` CLI commands,
- use `emwaver gateway` on localhost,
- optionally access it over VPN/Tailscale/port-forwarding at the user's own discretion.

Continual-hosted relay/control should not be part of the open-source product plan.

Native macOS and Windows apps should not be positioned as Continual-hosted remote-control hosts in the open-source core. Their gateway role is same-machine localhost app control:

```text
browser on this machine
  <-> localhost gateway
  <-> local native app
  <-> local board
```

If a user wants to control that machine from elsewhere, the product answer should be user-owned infrastructure around the local tool:

- SSH into the machine and run `emwaver` CLI commands,
- SSH port-forward the localhost gateway,
- use VPN/Tailscale to reach the machine by deliberate user choice.

Do not treat "macOS/Windows app visible anywhere through Continual cloud" as a core launch feature.

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

Gateway should bind to localhost by default. Exposing it beyond the machine is a user-owned networking/security decision, not a Continual MI cloud responsibility.

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
  localhost host-controller server
  local WebSocket protocol
  local macOS/Windows app WebSocket bridge
  serves the control UI

web/
  public website
  docs
  downloads
  mostly static product pages
```

Move the heavy `.emw` script dashboard/control experience into `gateway/` over time. Gateway controls the local macOS/Windows app and reuses the native app-owned runtime/device stack. `web/` should not be the long-term owner of auth-gated hardware control, cloud dashboard behavior, hosted relay UI, or local script rendering.

Scripts and local project state should stay on the user's device by default. Gateway may support browser-local open/save and app-local storage, but the core product should not add cloud script storage or script syncing.

`web/` should also move away from deployable backend/runtime responsibility. The target deployment model is closer to `society`: static pages exported and published to a simple blob/static website container, with CDN/front-door style routing in front of it if needed. The public EMWaver web surface should be landing pages, docs, install/build pages, board manager pages, product media, downloads, and static board/module references. It should not require a long-running `emwaver-web` container just to serve the public site.

Any remaining dynamic behavior should be moved to the correct owner instead of keeping `web/` as a catch-all backend:

- local script rendering/control goes to `gateway/`,
- optional paid Agent API goes to a focused Continual MI/MGPT Agent backend endpoint,
- board/build pages should read from static manifests and repo-backed hardware assets where practical.

Gradually remove from the local gateway path:

- cloud auth,
- account-required flows,
- subscription checks,
- device activation gates,
- hardware-UID identity gates,
- device minting/claiming flows,
- backend device limits,
- remote host heartbeat,
- cloud host/session discovery,
- cloud file assumptions,
- cloud script storage/sync assumptions.

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

## 7) Shared Device Simulator Direction

EMWaver development should include a reusable mock EMWaver device simulator so contributors can test `.emw` scripts and UI/runtime behavior without a physical board.

The simulator should be a shared product/testing asset, not a single-platform shortcut. The first layer should model the EMWaver firmware command protocol behind each platform's local device/runtime bridge:

```text
.emw script/runtime
  -> platform command bridge
  -> shared simulator behavior
  -> deterministic mock board state
```

This allows every platform to unit test with the same expected behavior:

- Rust CLI/runtime,
- macOS and iOS Swift runtime,
- Windows C# runtime,
- Android Kotlin runtime,
- gateway/browser protocol tests.

The initial simulator should focus on deterministic protocol coverage for core script APIs:

- device identity and board metadata,
- GPIO mode/read/write/pull/info,
- ADC reads,
- PWM start/write/stop,
- minimal SPI/I2C/UART transfer stubs,
- explicit error responses for unsupported commands.

The shared source of truth should be data-driven where practical, such as fixtures/scenarios that describe mock pins, ADC values, bus responses, and expected command replies. Platform-specific code can adapt those fixtures to native test doubles.

This is not a replacement for real hardware validation. It is a fast development and CI layer that catches runtime, script, UI, and protocol regressions before manual board testing.

An optional later layer may add a virtual MIDI/USB transport simulator for end-to-end transport tests. That should come after the command-protocol simulator, because OS-level fake devices are harder to make portable.

## 8) Agent Direction

Phase two is to make the Agent the main paid product.

The Agent should be accessed through a simple API key connected to the future Continual MI/MGPT backend endpoint. EMWaver should not introduce its own account model for this.

The backend should own and protect:

- the Agent system prompt,
- `.emw` language instructions,
- board/runtime rules,
- module-specific guidance,
- product policy,
- usage metering.

The open-source repo should keep Agent interfaces and request contracts, but it should not contain proprietary Agent IP:

- no production system prompts,
- no private `.emw` instruction packs,
- no hidden board recipes,
- no provider routing logic,
- no metering or account policy.

The client should send user intent, relevant script context, selected board/module metadata, and runtime errors. The server should apply the private Agent instructions and return useful `.emw` code, patches, explanations, or debugging guidance.

This keeps the open-source runtime useful while making the specialized Agent harder to clone immediately. The defensible value should be the combination of:

- `.emw` expertise,
- hardware/module recipes,
- runtime-aware debugging,
- high-quality examples,
- fast updates to Agent instructions,
- tight integration with the local gateway and CLI.

Prompt secrecy alone should not be treated as the moat. The moat is the maintained Agent service and its practical usefulness.

## 9) Hardware Monorepo Direction

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
- keep board photos, renders, diagrams, and reusable board/module media in the relevant `hardware/<repo-name>/` folder when they describe that hardware,
- make `web/`, docs, board catalogs, and app surfaces reference canonical hardware assets instead of carrying duplicate copies,
- keep app/runtime/platform source in the existing platform folders,
- keep bundled app-consumed firmware payloads under `firmware/`,
- keep board/module manufacturing details inside the relevant hardware subfolder,
- avoid top-level clutter from imported repo roots,
- curate large generated outputs carefully,
- use Git LFS only if large binary assets become unavoidable.

This consolidation should support the local-first open-source pivot, but it should not block the gateway/CLI/runtime work.

## 10) Phases

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
- Keep gateway as a browser-to-native-app host controller rather than a second runtime or third-party core service.
- Add `emwaver run`.
- Add `emwaver devices`.
- Add `emwaver doctor`.
- Add a shared mock device simulator so runtime and platform tests can run hardware-touching `.emw` scripts without a connected board.

## Phase 3: Cloud Removal From Core

- Remove cloud auth assumptions from local control.
- Remove cloud activation gates from core runtime.
- Remove subscription checks from hardware access.
- Remove hardware-UID registration, minting, claiming, and device-limit assumptions from core runtime.
- Keep any hosted service code outside the local gateway path.
- Remove hosted native-app remote-control posture from the core product path; keep same-machine localhost gateway control as the default.

## Phase 4: Paid Agent

- Add API-key based Agent access.
- Keep prompts and specialized instructions server-side.
- Integrate Agent into the local browser UI.
- Integrate Agent into the CLI.
- Meter Agent usage through the Continual MI/MGPT backend.

## Phase 5: Hardware Monorepo Import

- Inventory the existing EMWaver hardware repositories.
- Confirm the final flat `hardware/<repo-name>/` prefixes.
- Import one hardware repo first as a trial.
- Preserve history with `git subtree` or equivalent.
- Add local READMEs where needed so each imported hardware folder is understandable in place.
- Update product docs and scripts to reference the new in-repo hardware paths.
- Move duplicated board/module images and reusable hardware media to canonical `hardware/<repo-name>/` asset locations.

## Phase 6: Remove EMWaver Cloud Surface

Remove or retire the remaining EMWaver account/cloud surfaces instead of productizing them:

- auth/account pages,
- cloud dashboard routes,
- hosted relay and host directory routes,
- cloud script file APIs,
- sync assumptions,
- billing/subscription UI tied to local hardware access.

The surviving paid network surface should be the Agent API key path to the Continual MI/MGPT backend.

## 11) Product Language

Use language like:

- local-first,
- open-source core,
- localhost gateway,
- hardware scripting,
- `.emw` runtime,
- mock device simulator,
- Agent-assisted scripting,
- optional paid Agent,
- Agent API key.

Avoid centering:

- cloud platform,
- accounts,
- device activation,
- subscription-gated hardware,
- remote relay as the main product,
- account-first onboarding.

## 12) Launch Story

The new launch story is:

> EMWaver is an open-source local hardware scripting environment. Run `.emw` scripts against real boards from a CLI or localhost browser UI. When you want help, the paid EMWaver Agent writes and debugs hardware scripts with you.

This is simpler, easier to trust, easier to adopt, and less operationally heavy than launching as a cloud hardware platform.
