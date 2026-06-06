# EMWaver Planning

This is the durable working tracker for current EMWaver priorities. `SCHEDULE.md` is the short-term execution tracker.

## Current Focus

- **Open-source readiness:** make the active native-app + desktop MCP architecture easy to understand, with superseded browser/daemon and in-app Agent/MGPT plans archived.
- **Mobile-first product:** iOS and Android are primary. The phone is the portable local hardware lab.
- **Desktop apps:** macOS and Windows are active native apps for development, bench testing, firmware setup, long runs, advanced workflows, and the local MCP bridge.
- **Linux native app:** Linux is being rebuilt as a native Rust + GTK4/libadwaita app and should get the same desktop MCP direction when the runtime is ready.
- **Script + UI model:** EMWaver scripts are `.js` files. Scripts may use JSX-style syntax to define native UI panels for modules.
- **Desktop MCP tools:** the former Agent hardware primitives (`spi_transfer`, `gpio_read`, `gpio_write`, `analog_read`) move to the local desktop MCP surface alongside script lifecycle tools.
- **Multi-transport:** USB, BLE, and Wi-Fi remain first-class depending on board capability. Wi-Fi supports LAN/VPN-style remote hardware control for supported boards.
- **Hardware family:** nine hardware designs are imported under `hardware/`, covering compact USB-C control, radio, infrared, GPIO, RFID, and ESP32-S3 wireless workflows.

## Active Work

| Priority | Area | Status | Notes |
| --- | --- | --- | --- |
| `P0` | Agent-to-MCP migration | `active` | Remove in-app Agent/MGPT, make desktop MCP + filesystem scripts canonical, and keep mobile as local script import/run. Plan: `docs/AGENT_TO_MCP_MIGRATION.html`; contract: `docs/MCP_CONTRACT.md`. |
| `P0` | Cross-platform CC1101 validation | `done` | `cc1101.js` reads/writes registers across Windows, macOS, Android, and iOS (2026-05-24). |
| `P0` | Documentation cleanup | `active` | Remove stale Agent/MGPT, old browser/daemon control-plane, Windows-deferred, and Linux-removed wording from active/public docs and platform READMEs. |
| `P0` | MCP hardware primitive tools | `done/source` | Desktop MCP source now exposes `spi_transfer`, GPIO, and analog tools backed by native app/device transports on macOS, Windows, and Linux. Real-hardware validation remains part of the hardware test suite. |
| `P0` | Script-defined native UI | `active` | JavaScript scripts can define instant native panels with JSX-style syntax. Keep docs clear that JSX is syntax inside JS, not a separate product surface. |
| `P0` | Mobile UI polish | `active` | Improve iOS and Android script/device flows for phone use after Agent/MGPT removal. |
| `P1` | ESP32 Wi-Fi transport | `hardware validation pending` | Validate same-LAN and LAN/VPN-style control on real ESP32-S3 hardware. |
| `P1` | Native Linux app | `in progress` | Port the native-app model to Rust + GTK4/libadwaita with USB/BLE/Wi-Fi. Plan: `docs/LINUX_GTK4_PORT_PLAN.html`. |
| `P1` | Device simulator | `active` | Shared fixture across native platforms for protocol and UI testing. |
| `P1` | Hardware media/assets | `planned` | Keep canonical board/module images and manufacturing files under `hardware/<board>/`. |
| `P2` | Multi-device automation bench | `planned` | Two or more simultaneous boards with isolated device/script buffers. |

## Next Up

1. Run preview release workflows for signed Android APK, macOS DMG, and Windows installer/ZIP; verify all `emwaver-preview` release assets before opening the repo.
2. Clean the public website docs, especially script/UI docs and install/status pages.
3. Archive old Agent/MGPT docs and replace references with the desktop MCP migration plan.
4. Rebuild the hardware validation suite around native apps, real hardware scripts, MCP primitive tools, and simulator fixtures.
5. Update platform READMEs where they still mention old Agent/MGPT configuration, old browser/daemon control-plane paths, Windows as deferred, or Linux as removed.
6. Capture concise CC1101 validation evidence for iOS, Android, macOS, and Windows.
7. Continue the Linux native app port and plan its desktop MCP surface with the runtime.

## Blockers / Risks

- Docs are still catching up with the architecture. Public-facing docs should be cleaned before a wider announcement.
- Wi-Fi transport still needs concise real-hardware validation notes.
- Hardware media can drift between website and `hardware/`; prefer canonical assets in board folders.
- Windows builds require a Windows workstation/toolchain even though Windows is an active platform.
- Linux fragmentation means the first native Linux target should stay focused and staged.

## Notes

- Keep this file concise and current.
- Move historical planning to `docs/archive/` instead of letting stale docs remain in active paths.
- User-facing docs should point to https://emwaver.ai/emwaver/docs/.
