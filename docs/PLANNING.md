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

- **V1 is mobile-first**: iOS and Android are the primary launch platforms. The phone is the tricorder — the device users always carry. The Agent is the interface; users don't need a desktop editor if the Agent writes and debugs scripts.
- **macOS** remains the development/advanced surface for firmware flashing, multi-device bench testing, and long automation runs.
- **Windows** is deferred past V1. Source exists but requires a separate Windows toolchain.
- The Gateway, CLI, browser UI, and prior Linux support were removed in May 2026 (`docs/DROP_GATEWAY_AND_LINUX.md`). If Linux is revisited, the intended direction is a native Rust + GTK4/libadwaita app, not a Gateway revival. Plan: `docs/LINUX_GTK4_PORT_PLAN.html`.
- Agent-driven hardware automation: the native Agent uses named hardware primitive tools (`spi_transfer`, `gpio_read`, `gpio_write`, etc.) that send native EMW protocol packets through the local device. See `docs/AGENT_EVAL_RUNTIME.md`.
- **Mobile UI redesign**: iOS and Android need a redesigned Agent-first UI optimized for phone form factors. This is the next major design/implementation task.
- Cross-platform Agent/UI parity: iOS, Android, macOS should converge on one end-user Agent/editor/run experience, one `.js`/`.jsx` script surface, and identical example/library/kernel exposure. Plan: `docs/CROSS_PLATFORM_AGENT_UI_MIGRATION_PLAN.html`.
- Multi-device test bench goal: support a local hardware "box" with at least two simultaneously connected EMWaver boards. macOS implementation plan: `docs/MACOS_MULTI_DEVICE_PLAN.md`.
- Transport/session isolation: fully isolate script/device buffers. Plan: `docs/TRANSPORT_SESSION_ISOLATION_PLAN.md`.

## Active Work

| Priority | Area | Status | Notes |
| --- | --- | --- | --- |
| `P0` | Agent hardware primitive tools | `implemented / validating` | `spi_transfer`, `gpio_read/write/mode`, `analog_read` implemented in macOS native Agent. Validate against real CC1101 and extend coverage. See `docs/AGENT_EVAL_RUNTIME.md`. |
| `P0` | Mobile UI redesign (iOS + Android) | `planned` | Redesign Agent-first UI optimized for phone form factors. The Agent is the interface — chat-driven hardware exploration, native JSX renderer, script library, and device connection flow. iOS and Android should converge on the same UX patterns. |
| `P2` | Native Linux app | `candidate plan` | If prioritized after V1 mobile work, port macOS behavior to a native Rust + GTK4/libadwaita app with USB/BLE/Wi-Fi and firmware tooling. See `docs/LINUX_GTK4_PORT_PLAN.html`. |
| `P0` | Cross-platform Agent/UI parity | `planned` | Use `CROSS_PLATFORM_AGENT_UI_MIGRATION_PLAN.html` to converge iOS, Android, macOS toward identical Agent UX, native JSX UI, shared examples. |
| `P0` | Multi-device automation bench | `planned` | Two simultaneous boards. Plan: `docs/MACOS_MULTI_DEVICE_PLAN.md`. |
| `P0` | Transport/session isolation | `planned` | Per-device buffer isolation. Plan: `docs/TRANSPORT_SESSION_ISOLATION_PLAN.md`. |
| `P1` | ESP32 Wi-Fi transport | `hardware validation pending` | Firmware, macOS, and compile validation wired. Remaining hardware gates: `008_ESP32_WIFI_LAN_SCRIPT_EXECUTION` and `009_ESP32_WIFI_VPN_BY_IP_EXECUTION` in `TESTS.md`. |
| `P0` | Device simulator | `done for protocol adapters` | Shared fixture across all platforms. Apple `SimulatorScriptDevice`, Windows `SimulatorCommandBridge`, Android `SimulatorScriptDeviceBridge`. |
| `P0` | Agent interfaces | `mostly migrated` | All native Agent paths use API-key endpoint clients. Remaining: enrich runtime/hardware request context. |
| `P0` | Device identity gates | `done for primary native paths` | macOS and Windows local connect/update paths no longer read hardware UIDs or gate flashing on account state. |
| `P0` | Hardware monorepo | `done` | Nine primary hardware repos imported under `hardware/<repo-name>/`. |
| `P1` | Static public web | `done` | Public pages in `web/`, export to `web/out-emwaver`, deployed to `emwaver.ai`. |
| `P1` | Hardware media assets | `planned` | Board/module images should be canonical under `hardware/<repo-name>/`. |
| `P1` | Promo/video work | `paused` | Superseded by rebirth direction until launch story is settled. |
| `P1` | Hardware validation (`004`, `005`) | `pending` | PWM servo and RFID card clone end-to-end. |

## Next Up

1. Design and implement the mobile-first Agent UI for iOS and Android.
2. Run `008_ESP32_WIFI_LAN_SCRIPT_EXECUTION`: provision a real ESP32-S3, verify same-LAN mDNS/IP script execution, Wi-Fi drop recovery, USB/BLE recovery, and GPIO/ADC/SPI/PWM/sampler/retransmit coverage.
3. Run `009_ESP32_WIFI_VPN_BY_IP_EXECUTION`: verify user-owned VPN/private-IP script execution, manual IP fallback, diagnosed behavior, and no hosted relay/account path.
4. Validate `spi_transfer` against a real CC1101 session and extend hardware tool coverage.
5. Build the cross-platform Agent/UI parity checklist from current macOS behavior.
6. Design the multi-device runtime contract for two simultaneous boards.
7. Inventory public web and hardware folders for duplicated board/module images.

## Blockers / Risks

- EMWaver's own static export/deploy owns public product pages at `emwaver.ai`.
- Existing native Agent implementations should keep converging on the MGPT API-key contract and richer local context payloads.
- Duplicated hardware media can cause drift; prefer canonical assets under `hardware/<repo-name>/`.
- Keep future work from reintroducing SaaS activation, UID minting, hosted relay, or account-gated local hardware behavior.
- Windows native app development is blocked on this machine (requires Windows 11 + Visual Studio). The parity contracts require Windows parity; this is a known gap.
- A future Linux app should remain a native desktop app plan and must not reintroduce the removed Gateway/browser/CLI architecture.

## Notes

- Keep this file concise and current.
- When priorities change, update this file in the same pass as the related work whenever possible.
- Archived Gateway/CLI/Linux planning docs are in `docs/archive/`.
