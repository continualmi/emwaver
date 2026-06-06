# EMWaver Planning

This is the durable working tracker for current EMWaver priorities. `SCHEDULE.md` is the short-term execution tracker.

## Current Focus

- **Open-source readiness:** make the active native-app + desktop MCP architecture easy to understand, with superseded browser/daemon and in-app Agent/MGPT plans archived.
- **Mobile-first product:** iOS and Android are primary. The phone is the portable local hardware lab.
- **Desktop apps:** macOS and Windows are active native apps for development, bench testing, firmware setup, long runs, advanced workflows, and the local MCP bridge.
- **Linux native app:** Linux is being rebuilt as a native Rust + GTK4/libadwaita app and now carries the desktop MCP source slice; GTK-host validation remains pending.
- **Script + UI model:** EMWaver scripts are `.js` files. Scripts may use JSX-style syntax to define native UI panels for modules.
- **Desktop MCP tools:** script lifecycle, device status, and hardware primitives (`spi_transfer`, `gpio_read`, `gpio_write`, `analog_read`) live on the local desktop MCP surface.
- **Multi-transport:** USB, BLE, and Wi-Fi remain first-class depending on board capability. Wi-Fi supports LAN/VPN-style remote hardware control for supported boards.
- **Hardware family:** nine hardware designs are imported under `hardware/`, covering compact USB-C control, radio, infrared, GPIO, RFID, and ESP32-S3 wireless workflows.

## Active Work

| Priority | Area | Status | Notes |
| --- | --- | --- | --- |
| `P0` | Agent-to-MCP migration | `done/source` | In-app Agent/MGPT source has been removed, desktop MCP + filesystem scripts are canonical on desktop, and mobile remains local script import/run. Contract: `docs/MCP_CONTRACT.md`; public docs: `/docs/mcp`. |
| `P0` | Cross-platform CC1101 validation | `done` | `cc1101.js` reads/writes registers across Windows, macOS, Android, and iOS (2026-05-24). |
| `P0` | Documentation cleanup | `done/source` | Active/public docs and platform READMEs now reflect desktop MCP, Linux preview, Windows active, and no old browser/daemon control plane. |
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
2. Rebuild the hardware validation suite around native apps, real hardware scripts, MCP primitive tools, and simulator fixtures.
3. Capture concise CC1101 validation evidence for iOS, Android, macOS, and Windows.
4. Validate the Linux desktop MCP slice on a GTK4/libadwaita host.
5. Continue Linux native app runtime, packaging, and Wi-Fi provisioning parity.

## Blockers / Risks

- Linux desktop MCP still needs app-level validation on a GTK4/libadwaita host.
- Wi-Fi transport still needs concise real-hardware validation notes.
- Hardware media can drift between website and `hardware/`; prefer canonical assets in board folders.
- Windows builds require a Windows workstation/toolchain even though Windows is an active platform.
- Linux fragmentation means the first native Linux target should stay focused and staged.

## Notes

- Keep this file concise and current.
- Move historical planning to `docs/archive/` instead of letting stale docs remain in active paths.
- User-facing docs should point to https://emwaver.ai/docs/.
