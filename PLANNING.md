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

- EMWaver rebirth: local-first open-source runtime, localhost gateway, CLI-driven `.emw` execution, hardware monorepo consolidation, and paid Agent as the primary business model.
- First implementation slice is tracked in `REBIRTH_ISSUES.md`: gateway package, local WebSocket endpoint, runtime/device extraction, shared mock device simulator contract, `emwaver run`, web control UI inventory, account-free local hardware control, and hardware repo inventory.

## Active Work

| Priority | Area | Status | Notes |
| --- | --- | --- | --- |
| `P0` | Rebirth plan | `in progress` | `REBIRTH.md` captures the product pivot toward local-first open source EMWaver with paid Agent services. |
| `P0` | Rebirth backlog | `in progress` | `REBIRTH_ISSUES.md` is the durable issue backlog. Start with the first implementation slice listed at the bottom of that file. |
| `P0` | Local gateway | `in progress` | `gateway/` exists as a localhost browser-to-native-app WebSocket bridge; macOS and Windows now have source-level local `role=app` wiring and need native validation. |
| `P0` | Runtime + CLI | `in progress` | Rust runtime/device crates are extracted, `CommandBridge` decouples runtime from MIDI transport, selected-device daemon startup builds, direct UI-only `emwaver run` works, and `doctor` is verified locally. Hardware-backed validation remains. |
| `P0` | Device simulator | `in progress` | Shared fixture, Rust `CommandBridge`, CLI `--sim-device`, and Apple `SimulatorScriptDevice` are added; Windows and Android adapters remain. |
| `P0` | Remote control scope | `planned` | Native apps should default to same-machine localhost gateway control; hosted macOS/Windows remote control is not core launch scope. |
| `P0` | Hardware monorepo | `done` | The nine primary hardware repos are imported under flat `hardware/<repo-name>/` paths with subtree history. |
| `P1` | Promo/video work | `paused` | Promo work is superseded by the rebirth direction until the local-first launch story is settled. |
| `P1` | Hardware validation (`004`, `005`) | `pending` | Still useful, but no longer the top planning focus while architecture pivots. |

## Next Up

1. Validate macOS and Windows local gateway app-role wiring on native workstations.
2. Add Windows and Android simulator adapters from the shared fixture contract.
3. Audit macOS/Windows hosted remote-control services and keep them outside the core localhost gateway path.
4. Continue gateway UI migration from the completed `gateway/WEB_CONTROL_INVENTORY.md` classification.
5. Validate local gateway script execution on real hardware.
6. Validate `emwaver run --direct --device <id>` against attached hardware.
7. Review older/generated hardware catalog IDs and decide whether they map to imported repos or need separate cleanup.

## Blockers / Risks

- The current `web/` app mixes public site, auth/billing, cloud relay, Agent routes, and hardware control UI; migration needs careful boundaries.
- The Rust daemon still has hosted WebSocket behavior in `emwaver-host`; keep local gateway work pointed at browser-to-native-app bridging, not a second gateway-owned runtime.
- Existing macOS/Windows remote host services should not pull hosted relay assumptions back into the core app/gateway experience.
- Hardware repo import should preserve history and avoid root-level clutter.
- Existing product docs still describe the older software-first SaaS/cloud activation model and need follow-up updates.

## Notes

- Keep this file concise and current.
- When priorities change, update this file in the same pass as the related work whenever possible.
