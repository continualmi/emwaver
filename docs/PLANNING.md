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

- Gateway consolidation: `gateway/` becomes the single owner of the local backend, CLI, runtime, transports, and browser frontend. The controlling migration document is `gateway/MIGRATION.md`.
- EMWaver rebirth: local-first open-source runtime, Gateway-driven `.emw` execution, hardware monorepo consolidation, and paid Agent API usage through the future Continual MI/MGPT backend as the primary business model.
- Agent-driven hardware automation: make the local CLI/Gateway loop good enough that a coding agent can write custom `.emw` scripts, run them against real hardware, inspect UI snapshots/status, send UI events, stop/reset scripts, and iterate quickly from the terminal.
- Multi-device test bench goal: support a local hardware "box" with at least two simultaneously connected EMWaver boards, initially two ESP32-S3 BLE devices or one ESP32-S3 BLE device plus one USB MIDI STM32, so one agent session can probe modules, transports, scripts, and hardware feedback loops end to end.
- First implementation slice is tracked in `REBIRTH_ISSUES.md`: gateway package, local WebSocket endpoint, runtime/device extraction, shared mock device simulator contract, `emwaver run`, account-free local hardware control, hardware repo inventory, static web deployment migration, and hardware asset deduplication.

## Active Work

| Priority | Area | Status | Notes |
| --- | --- | --- | --- |
| `P0` | Rebirth plan | `in progress` | `REBIRTH.md` captures the product pivot toward local-first open source EMWaver with paid Agent services. |
| `P0` | Rebirth backlog | `in progress` | `REBIRTH_ISSUES.md` is the durable issue backlog. Start with the first implementation slice listed at the bottom of that file. |
| `P0` | Gateway consolidation | `in progress` | `gateway/MIGRATION.md` controls the move to a single Gateway-owned backend/frontend/CLI/runtime/transport folder, with no old service terminology, no direct CLI mode, and no native app control path. |
| `P0` | Local Gateway | `in progress` | The browser-to-native app bridge shape has been replaced by the Gateway-owned backend/frontend model in `gateway/MIGRATION.md`; final docs and validation are pending. |
| `P0` | Runtime + CLI | `code complete / validation pending` | Rust runtime/device crates moved to `gateway/backend/`; `emwaver run` now requires Gateway, and simulator/no-device/hardware transports are Gateway startup modes. |
| `P0` | UI snapshot-only runtime | `Gateway slice complete` | `UI_SNAPSHOT_RUNTIME_MIGRATION.md` now has Gateway-owned session list/snapshot/event/stop CLI workflows, no Gateway script logging API, and cleaned bundled scripts; native runtime cleanup remains. |
| `P0` | Multi-device automation bench | `planned` | Target a local test box with two simultaneous boards: two ESP32-S3 BLE devices, or ESP32-S3 BLE plus USB MIDI STM32. The CLI/gateway/runtime should expose device discovery, stable selection, concurrent connections, per-device script commands, and snapshots/events so an agent can validate hardware modules and loops without manual app work. macOS implementation plan: `MACOS_MULTI_DEVICE_PLAN.md`. |
| `P0` | Transport/session isolation | `planned` | Fully isolate script/device buffers, command response waiters, parser state, sampler state, and stop/reset lifecycle so multiple scripts can run in parallel across devices without contamination. Plan: `TRANSPORT_SESSION_ISOLATION_PLAN.md`. |
| `P1` | ESP32 Wi-Fi transport | `hardware validation pending` | Firmware, macOS, Gateway, docs, and compile validation are wired for the local-first LAN/VPN Wi-Fi transport. Plan: `ESP32_WIFI_TRANSPORT_PLAN.md`; audit: `ESP32_WIFI_TRANSPORT_AUDIT.md`; remaining hardware gates: `008_ESP32_WIFI_LAN_SCRIPT_EXECUTION` and `009_ESP32_WIFI_VPN_BY_IP_EXECUTION` in `TESTS.md`. |
| `P0` | Device simulator | `done for protocol adapters` | Shared fixture, Rust `CommandBridge`, CLI `--sim-device`, Apple `SimulatorScriptDevice`, Windows `SimulatorCommandBridge`, and Android `SimulatorScriptDeviceBridge` are added; virtual transport was evaluated and kept optional/local-only. |
| `P0` | Remote control scope | `code complete / validation pending` | Native apps are self-contained; CLI/browser control uses Gateway and does not route through native app host services. |
| `P0` | Agent interfaces | `mostly migrated` | Repo-shipped production prompt files are removed; gateway/CLI plus Apple iOS/macOS, Windows, and Android Agent paths now use API-key endpoint clients instead of EMWaver account chat routes. Remaining work: enrich runtime/hardware request context. |
| `P0` | Device identity gates | `done for primary native paths` | macOS and Windows local connect/update paths no longer read hardware UIDs or gate flashing on minting/claiming/account state. |
| `P0` | Hardware monorepo | `done` | The nine primary hardware repos are imported under flat `hardware/<repo-name>/` paths with subtree history. |
| `P1` | Static public web | `migrated to EMWaver repo` | Public EMWaver static pages live in `web/`, export to `web/out-emwaver`, and are being tested on GitHub Pages for the open-source release. Society keeps only a lightweight `/emwaver` bridge to `emwaver.ai`. |
| `P1` | Hardware media assets | `planned` | Board/module images, renders, and diagrams should be canonical under `hardware/<repo-name>/` and referenced by docs/static surfaces instead of duplicated. |
| `P1` | Promo/video work | `paused` | Promo work is superseded by the rebirth direction until the local-first launch story is settled. |
| `P1` | Hardware validation (`004`, `005`) | `pending` | Still useful, but no longer the top planning focus while architecture pivots. |

## Next Up

1. Finish the Gateway consolidation validation pass: docs audit, help output, offline `run` behavior, simulator-backed Gateway execution, browser verify, and native app role cleanup checks.
2. Run `008_ESP32_WIFI_LAN_SCRIPT_EXECUTION`: provision a real ESP32-S3, verify same-LAN mDNS/IP script execution, second-client busy handling, Wi-Fi drop recovery, USB/BLE recovery, and GPIO/ADC/SPI/PWM/sampler/retransmit coverage.
3. Run `009_ESP32_WIFI_VPN_BY_IP_EXECUTION`: verify user-owned VPN/private-IP script execution, manual IP fallback without mDNS, reachable/busy/connection-failed behavior, reconnect behavior, and no hosted relay/account path.
4. Implement the UI snapshot-only runtime migration: remove script logging APIs, clean default scripts, and add session list/snapshot/event/stop CLI commands.
5. Design the multi-device runtime contract for two simultaneous boards: device ids, transport labels, per-device status, routing commands to a chosen board, and UI/snapshot attribution.
6. Review older/generated hardware catalog IDs and decide whether they map to imported repos or need separate cleanup.
7. Inventory public web and hardware folders for duplicated board/module images and choose canonical `hardware/<repo-name>/` asset paths.

## Blockers / Risks

- EMWaver's own static export/deploy now owns public product pages; Society links to `https://emwaver.ai`.
- Existing native Agent implementations should keep converging on the MGPT API-key contract and richer local context payloads.
- Hardware repo import should preserve history and avoid root-level clutter.
- Duplicated hardware media can make static pages and board docs drift; prefer canonical assets under `hardware/<repo-name>/`.
- Broad legacy-cloud scans now return only negative guardrails or historical backlog context; keep future work from reintroducing SaaS activation, UID minting, hosted relay, or account-gated local hardware behavior.

## Notes

- Keep this file concise and current.
- When priorities change, update this file in the same pass as the related work whenever possible.
