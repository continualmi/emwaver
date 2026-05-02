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
- First implementation slice is tracked in `REBIRTH_ISSUES.md`: gateway package, local WebSocket endpoint, runtime/device extraction, `emwaver run`, web control UI inventory, account-free local hardware control, and hardware repo inventory.

## Active Work

| Priority | Area | Status | Notes |
| --- | --- | --- | --- |
| `P0` | Rebirth plan | `in progress` | `REBIRTH.md` captures the product pivot toward local-first open source EMWaver with paid Agent services. |
| `P0` | Rebirth backlog | `in progress` | `REBIRTH_ISSUES.md` is the durable issue backlog. Start with the first implementation slice listed at the bottom of that file. |
| `P0` | Local gateway | `prototype done` | `gateway/` exists as a localhost browser-to-native-app WebSocket bridge and still needs native app wiring. |
| `P0` | Runtime + CLI | `in progress` | `emwaver run` now sends scripts to the localhost gateway/native-app bridge; Rust build and deeper runtime/device extraction remain blocked by missing toolchain. |
| `P0` | Hardware monorepo | `done` | The nine primary hardware repos are imported under flat `hardware/<repo-name>/` paths with subtree history. |
| `P1` | Promo/video work | `paused` | Promo work is superseded by the rebirth direction until the local-first launch story is settled. |
| `P1` | Hardware validation (`004`, `005`) | `pending` | Still useful, but no longer the top planning focus while architecture pivots. |

## Next Up

1. Wire the native macOS/Windows app WebSocket role to the localhost gateway.
2. Inventory current `web/` control UI files for gateway migration.
3. Build/verify the Rust CLI once `cargo`/`rustc` are installed.
4. Extract a reusable runtime/device layer where native apps and the headless host actually need shared code.
5. Review older/generated hardware catalog IDs and decide whether they map to imported repos or need separate cleanup.

## Blockers / Risks

- The current `web/` app mixes public site, auth/billing, cloud relay, Agent routes, and hardware control UI; migration needs careful boundaries.
- The current daemon runtime is coupled to outbound cloud WebSocket host behavior; local gateway and CLI need shared runtime/device extraction.
- Hardware repo import should preserve history and avoid root-level clutter.
- Existing product docs still describe the older software-first SaaS/cloud activation model and need follow-up updates.

## Notes

- Keep this file concise and current.
- When priorities change, update this file in the same pass as the related work whenever possible.
