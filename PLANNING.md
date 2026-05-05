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
- First implementation slice is tracked in `REBIRTH_ISSUES.md`: gateway package, local WebSocket endpoint, runtime/device extraction, shared mock device simulator contract, `emwaver run`, account-free local hardware control, hardware repo inventory, static web deployment migration, and hardware asset deduplication.

## Active Work

| Priority | Area | Status | Notes |
| --- | --- | --- | --- |
| `P0` | Rebirth plan | `in progress` | `REBIRTH.md` captures the product pivot toward local-first open source EMWaver with paid Agent services. |
| `P0` | Rebirth backlog | `in progress` | `REBIRTH_ISSUES.md` is the durable issue backlog. Start with the first implementation slice listed at the bottom of that file. |
| `P0` | Local gateway | `in progress` | `gateway/` exists as a localhost browser-to-native-app WebSocket bridge; macOS and Windows now have source-level local `role=app` wiring and need native validation. |
| `P0` | Runtime + CLI | `in progress` | Rust runtime/device crates are extracted, `CommandBridge` decouples runtime from MIDI transport, direct UI-only `emwaver run` works, and `doctor` is verified locally. Hardware-backed validation remains. |
| `P0` | Device simulator | `done for protocol adapters` | Shared fixture, Rust `CommandBridge`, CLI `--sim-device`, Apple `SimulatorScriptDevice`, Windows `SimulatorCommandBridge`, and Android `SimulatorScriptDeviceBridge` are added; virtual transport was evaluated and kept optional/local-only. |
| `P0` | Remote control scope | `done for local-first surfaces` | Native apps now use localhost gateway control as the core path; hosted relay/directory code has been removed from the primary local-first app surfaces. |
| `P0` | Agent interfaces | `mostly migrated` | Repo-shipped production prompt files are removed; gateway/CLI plus Apple iOS/macOS, Windows, and Android Agent paths now use API-key endpoint clients instead of EMWaver account chat routes. Remaining work: enrich runtime/hardware request context. |
| `P0` | Device identity gates | `done for primary native paths` | macOS and Windows local connect/update paths no longer read hardware UIDs or gate flashing on minting/claiming/account state. |
| `P0` | Hardware monorepo | `done` | The nine primary hardware repos are imported under flat `hardware/<repo-name>/` paths with subtree history. |
| `P1` | Static public web | `migrated to Society` | Public EMWaver static pages now live in `../society` under hidden `/emwaver` routes and deploy through the Society Azure Storage static workflow. This repo no longer carries a standalone `web/` app. |
| `P1` | Hardware media assets | `planned` | Board/module images, renders, and diagrams should be canonical under `hardware/<repo-name>/` and referenced by docs/static surfaces instead of duplicated. |
| `P1` | Promo/video work | `paused` | Promo work is superseded by the rebirth direction until the local-first launch story is settled. |
| `P1` | Hardware validation (`004`, `005`) | `pending` | Still useful, but no longer the top planning focus while architecture pivots. |

## Next Up

1. Validate Windows local gateway app-role wiring on a machine with the Windows/.NET toolchain.
2. Validate local gateway script execution on real hardware.
3. Validate `emwaver run --direct --device <id>` against attached hardware.
4. Review older/generated hardware catalog IDs and decide whether they map to imported repos or need separate cleanup.
5. Inventory Society `public/emwaver` and hardware folders for duplicated board/module images and choose canonical `hardware/<repo-name>/` asset paths.
6. Remove or redirect any remaining stale references to the retired standalone `web/` app.

## Blockers / Risks

- Society static export/deploy now owns EMWaver public pages; keep `/emwaver` hidden from primary navigation until launch-ready.
- Existing native Agent implementations should keep converging on the MGPT API-key contract and richer local context payloads.
- Hardware repo import should preserve history and avoid root-level clutter.
- Duplicated hardware media can make static pages and board docs drift; prefer canonical assets under `hardware/<repo-name>/`.
- Broad legacy-cloud scans now return only negative guardrails or historical backlog context; keep future work from reintroducing SaaS activation, UID minting, hosted relay, or account-gated local hardware behavior.

## Notes

- Keep this file concise and current.
- When priorities change, update this file in the same pass as the related work whenever possible.
