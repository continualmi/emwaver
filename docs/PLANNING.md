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
- Agent-driven hardware automation: make the local CLI/gateway/native-app loop good enough that a coding agent can write custom `.emw` scripts, run them against real hardware, inspect UI snapshots/logs, send UI events, stop/reset scripts, and iterate quickly from the terminal.
- Multi-device test bench goal: support a local hardware "box" with at least two simultaneously connected EMWaver boards, initially two ESP32-S3 BLE devices or one ESP32-S3 BLE device plus one USB MIDI STM32, so one agent session can probe modules, transports, scripts, and hardware feedback loops end to end.
- First implementation slice is tracked in `REBIRTH_ISSUES.md`: gateway package, local WebSocket endpoint, runtime/device extraction, shared mock device simulator contract, `emwaver run`, account-free local hardware control, hardware repo inventory, static web deployment migration, and hardware asset deduplication.

## Active Work

| Priority | Area | Status | Notes |
| --- | --- | --- | --- |
| `P0` | Rebirth plan | `in progress` | `REBIRTH.md` captures the product pivot toward local-first open source EMWaver with paid Agent services. |
| `P0` | Rebirth backlog | `in progress` | `REBIRTH_ISSUES.md` is the durable issue backlog. Start with the first implementation slice listed at the bottom of that file. |
| `P0` | Local gateway | `in progress` | `gateway/` exists as a localhost browser-to-native-app/WebSocket bridge and browser renderer. Linux should present this primarily through the `emwaver` CLI, with macOS CLI support and future Windows CLI parity. |
| `P0` | Runtime + CLI | `in progress` | Rust runtime/device crates are extracted, `CommandBridge` decouples runtime from MIDI transport, direct UI-only `emwaver run` works, and `emwaver start`/`gateway --daemon-fallback` can connect browser-rendered scripts to the daemon underneath. Immediate goal: make `emw` excellent for agent-driven run/snapshot/event/stop/reset loops against local custom scripts. Hardware-backed Linux validation remains. |
| `P0` | Multi-device automation bench | `planned` | Target a local test box with two simultaneous boards: two ESP32-S3 BLE devices, or ESP32-S3 BLE plus USB MIDI STM32. The CLI/gateway/runtime should expose device discovery, stable selection, concurrent connections, per-device script commands, and snapshots/events so an agent can validate hardware modules and loops without manual app work. |
| `P0` | Device simulator | `done for protocol adapters` | Shared fixture, Rust `CommandBridge`, CLI `--sim-device`, Apple `SimulatorScriptDevice`, Windows `SimulatorCommandBridge`, and Android `SimulatorScriptDeviceBridge` are added; virtual transport was evaluated and kept optional/local-only. |
| `P0` | Remote control scope | `done for local-first surfaces` | Native apps now use localhost gateway control as the core path; hosted relay/directory code has been removed from the primary local-first app surfaces. |
| `P0` | Agent interfaces | `mostly migrated` | Repo-shipped production prompt files are removed; gateway/CLI plus Apple iOS/macOS, Windows, and Android Agent paths now use API-key endpoint clients instead of EMWaver account chat routes. Remaining work: enrich runtime/hardware request context. |
| `P0` | Device identity gates | `done for primary native paths` | macOS and Windows local connect/update paths no longer read hardware UIDs or gate flashing on minting/claiming/account state. |
| `P0` | Hardware monorepo | `done` | The nine primary hardware repos are imported under flat `hardware/<repo-name>/` paths with subtree history. |
| `P1` | Static public web | `migrated to EMWaver repo` | Public EMWaver static pages live in `web/`, export to `web/out-emwaver`, and are being tested on GitHub Pages for the open-source release. Society keeps only a lightweight `/emwaver` bridge to `emwaver.ai`. |
| `P1` | Hardware media assets | `planned` | Board/module images, renders, and diagrams should be canonical under `hardware/<repo-name>/` and referenced by docs/static surfaces instead of duplicated. |
| `P1` | Promo/video work | `paused` | Promo work is superseded by the rebirth direction until the local-first launch story is settled. |
| `P1` | Hardware validation (`004`, `005`) | `pending` | Still useful, but no longer the top planning focus while architecture pivots. |

## Next Up

1. Add/verify CLI commands for the agent loop: run a local `.emw`, wait for `script.started`, print or save the latest `ui.snapshot`, send `ui.event` by node id/handler token, stop the script, and report runtime/device status.
2. Fix development CLI ergonomics so `emw run path/to/script.emw` resolves paths from the caller's working directory while still using the repo dev wrapper.
3. Validate local gateway script execution on real hardware through the macOS native app, including custom scripts outside `assets/default-scripts`.
4. Validate `emwaver run --direct --ble` and `emwaver run --direct --device <id>` against attached hardware when the native app is not owning the device.
5. Design the multi-device runtime contract for two simultaneous boards: device ids, transport labels, per-device status, routing commands to a chosen board, and UI/snapshot attribution.
6. Validate Linux CLI/gateway/daemon execution on real USB and BLE hardware, including browser rendering through localhost.
7. Validate Linux `emwaver service install --ble` or `--device <id>` on a real systemd user session.
8. Validate Windows local gateway app-role wiring on a machine with the Windows/.NET toolchain.
9. Review older/generated hardware catalog IDs and decide whether they map to imported repos or need separate cleanup.
10. Inventory `web/public/emwaver` and hardware folders for duplicated board/module images and choose canonical `hardware/<repo-name>/` asset paths.

## Blockers / Risks

- EMWaver's own static export/deploy now owns public product pages; Society links to `https://emwaver.ai`.
- Existing native Agent implementations should keep converging on the MGPT API-key contract and richer local context payloads.
- Hardware repo import should preserve history and avoid root-level clutter.
- Duplicated hardware media can make static pages and board docs drift; prefer canonical assets under `hardware/<repo-name>/`.
- Broad legacy-cloud scans now return only negative guardrails or historical backlog context; keep future work from reintroducing SaaS activation, UID minting, hosted relay, or account-gated local hardware behavior.

## Notes

- Keep this file concise and current.
- When priorities change, update this file in the same pass as the related work whenever possible.
