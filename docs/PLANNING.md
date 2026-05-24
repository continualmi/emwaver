# EMWaver Planning

This is the durable working tracker for current EMWaver priorities. `SCHEDULE.md` is the short-term execution tracker and `TESTS.md` is the validation tracker.

## Current Focus

- **Open-source readiness:** clean public-facing docs, remove stale Gateway/CLI wording, and make the current native-app architecture easy to understand.
- **Mobile-first product:** iOS and Android are primary. The phone is the portable hardware lab and Agent interface.
- **Desktop apps:** macOS and Windows are active native apps for development, bench testing, firmware setup, long runs, and advanced workflows.
- **Linux native app:** Linux is being rebuilt as a native Rust + GTK4/libadwaita app. Do not revive the removed Gateway/browser/CLI architecture.
- **Script + UI model:** EMWaver scripts are `.js` files. Scripts may use JSX-style syntax to define native UI panels for modules.
- **Agent hardware tools:** the Agent uses named hardware primitives such as `spi_transfer`, `gpio_read`, `gpio_write`, and `analog_read` through the local native app/device transport.
- **Multi-transport:** USB, BLE, and Wi-Fi remain first-class depending on board capability. Wi-Fi supports LAN/VPN-style remote hardware control for supported boards.
- **Hardware family:** nine hardware designs are imported under `hardware/`, covering compact USB-C control, radio, infrared, GPIO, RFID, and ESP32-S3 wireless workflows.

## Active Work

| Priority | Area | Status | Notes |
| --- | --- | --- | --- |
| `P0` | Documentation cleanup | `active` | Remove stale Gateway/CLI, UI snapshot, separate `.jsx`, Windows-deferred, and internal wording from active/public docs. |
| `P0` | Cross-platform CC1101 validation | `active` | `cc1101.js` reads/writes registers across Windows, macOS, Android, and iOS. Capture concise evidence in `docs/TESTS.md`. |
| `P0` | Agent hardware primitive tools | `implemented / validating` | Validate `spi_transfer`, GPIO, analog, and module-probe flows against real hardware. Canonical model: `docs/AGENT_EVAL_RUNTIME.md`. |
| `P0` | Script-defined native UI | `active` | JavaScript scripts can define instant native panels with JSX-style syntax. Keep docs clear that JSX is syntax inside JS, not a separate product surface. |
| `P0` | Mobile UI polish | `active` | Improve iOS and Android Agent/script/device flows for phone use. |
| `P1` | ESP32 Wi-Fi transport | `hardware validation pending` | Validate same-LAN and LAN/VPN-style control on real ESP32-S3 hardware. |
| `P1` | Native Linux app | `in progress` | Port the native-app model to Rust + GTK4/libadwaita with USB/BLE/Wi-Fi. Plan: `docs/LINUX_GTK4_PORT_PLAN.html`. |
| `P1` | Device simulator | `active` | Shared fixture across native platforms for protocol and UI testing. |
| `P1` | Hardware media/assets | `planned` | Keep canonical board/module images and manufacturing files under `hardware/<board>/`. |
| `P2` | Multi-device automation bench | `planned` | Two or more simultaneous boards with isolated device/script buffers. |

## Next Up

1. Run preview release workflows for signed Android APK, macOS DMG, and Windows installer/ZIP; verify all `emwaver-preview` release assets before opening the repo.
2. Clean the public website docs, especially script/UI docs and install/status pages.
3. Replace Gateway-centered Wi-Fi docs with native-app USB/BLE/Wi-Fi transport docs.
4. Rewrite `docs/TESTS.md` around native apps, real hardware scripts, Agent primitive tools, and simulator fixtures.
5. Update platform READMEs where they still mention Gateway, UI snapshots as primary automation, or Windows as deferred.
6. Capture concise CC1101 validation evidence for iOS, Android, macOS, and Windows.
7. Continue the Linux native app port without reintroducing a Gateway/browser/CLI control plane.

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
