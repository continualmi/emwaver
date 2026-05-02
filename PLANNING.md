# EMWaver Planning

This file is the durable working tracker for ongoing EMWaver priorities.

Use it to capture:
- what we are actively working on,
- what is blocked,
- what should happen next,
- any short planning notes that should survive beyond a single week.

`SCHEDULE.md` remains the weekly execution tracker.
`TESTS.md` remains the manual hardware validation tracker.

---

## Current Focus

- EMWaver rebirth: local-first open-source runtime, localhost gateway, CLI-driven `.emw` execution, hardware monorepo consolidation, and paid Agent API usage through the future Continual MI/MGPT backend as the primary business model.
- First implementation slice is tracked in `REBIRTH_ISSUES.md`: gateway package, local WebSocket endpoint, runtime/device extraction, shared mock device simulator contract, `emwaver run`, web control UI inventory, account-free local hardware control, hardware repo inventory, static web deployment migration, and hardware asset deduplication.

## Active Work

| Priority | Area | Status | Notes |
| --- | --- | --- | --- |
| `P0` | Rebirth plan | `in progress` | `REBIRTH.md` captures the product pivot toward local-first open source EMWaver with paid Agent services. |
| `P0` | Rebirth backlog | `in progress` | `REBIRTH_ISSUES.md` is the durable issue backlog. Start with the first implementation slice listed at the bottom of that file. |
| `P0` | Local gateway | `in progress` | `gateway/` exists as a localhost browser-to-native-app WebSocket bridge; macOS and Windows now have source-level local `role=app` wiring and need native validation. |
| `P0` | Runtime + CLI | `in progress` | Rust runtime/device crates are extracted, `CommandBridge` decouples runtime from MIDI transport, selected-device daemon startup builds, direct UI-only `emwaver run` works, and `doctor` is verified locally. Hardware-backed validation remains. |
| `P0` | Device simulator | `done for protocol adapters` | Shared fixture, Rust `CommandBridge`, CLI `--sim-device`, Apple `SimulatorScriptDevice`, Windows `SimulatorCommandBridge`, and Android `SimulatorScriptDeviceBridge` are added; virtual transport was evaluated and kept optional/local-only. |
| `P0` | Remote control scope | `done for defaults` | Native apps now default away from hosted remote control; hosted native `/v1/ws` and host directory/presence surfaces are opt-in flags, while macOS/Windows localhost gateway control remains the core path. |
| `P0` | Agent interfaces | `needs migration` | App-level Agent runtimes/interfaces should stay on gateway, CLI, Apple, Windows, and Android, but they should become API-key clients for the future Continual MI/MGPT backend and stop depending on EMWaver accounts/cloud chat storage or repo-shipped production prompts. |
| `P0` | Device identity gates | `needs removal` | Hardware UID reads, device minting/claiming, activation, and device limits are closed-source-platform remnants. The open-source core should work immediately without them. |
| `P0` | Hardware monorepo | `done` | The nine primary hardware repos are imported under flat `hardware/<repo-name>/` paths with subtree history. |
| `P1` | Static public web | `planned` | `web/` should trend toward Society-style static export to blob/static website hosting; auth/cloud dashboard/API/WebSocket runtime remains migration debt or should move to focused backends. |
| `P1` | Hardware media assets | `planned` | Board/module images, renders, and diagrams should be canonical under `hardware/<repo-name>/` and referenced by web/docs instead of duplicated. |
| `P1` | Promo/video work | `paused` | Promo work is superseded by the rebirth direction until the local-first launch story is settled. |
| `P1` | Hardware validation (`004`, `005`) | `pending` | Still useful, but no longer the top planning focus while architecture pivots. |

## Next Up

1. Watch the hosted Linux/Windows rebirth validation workflow on GitHub Actions and fix any CI-specific failures.
2. Validate macOS and Windows local gateway app-role wiring on native workstations.
3. Validate the hosted-surface defaults on iOS/Android devices and Windows workstation builds.
4. Continue gateway UI migration from the completed `gateway/WEB_CONTROL_INVENTORY.md` classification.
5. Validate local gateway script execution on real hardware.
6. Validate `emwaver run --direct --device <id>` against attached hardware.
7. Review older/generated hardware catalog IDs and decide whether they map to imported repos or need separate cleanup.
8. Inventory `web/public` and hardware folders for duplicated board/module images and choose canonical `hardware/<repo-name>/` asset paths.
9. Plan the static `web/` export/deploy migration using the Society blob/static website pattern.

## Blockers / Risks

- The current `web/` app mixes public site, auth/billing, cloud relay, Agent routes, and hardware control UI; migration needs careful boundaries before static export can become the canonical deploy.
- Existing native Agent implementations still point at EMWaver backend account/conversation routes. They should be retained as interfaces but migrated to the MGPT API-key contract.
- The Rust daemon still has hosted WebSocket behavior in `emwaver-host`; keep local gateway work pointed at browser-to-native-app bridging, not a second gateway-owned runtime.
- Existing macOS/Windows remote host services should not pull hosted relay assumptions back into the core app/gateway experience.
- Hardware repo import should preserve history and avoid root-level clutter.
- Duplicated hardware media can make static pages and board docs drift; prefer canonical assets under `hardware/<repo-name>/`.
- Existing product docs and native code still describe or implement older SaaS/cloud activation, UID, minting, and device-cache behavior; remove it from the local core path.

## Notes

- Keep this file concise and current.
- When priorities change, update this file in the same pass as the related work whenever possible.
