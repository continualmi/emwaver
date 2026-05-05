# macOS App (`/macos`)

Native macOS EMWaver application (Swift/SwiftUI + Xcode).

This is the desktop Apple host app for local USB workflows, localhost gateway control, Agent client UI, and firmware/update UX on macOS.

The local-first rule is that connected supported boards can run local `.emw` scripts immediately without account sign-in, backend activation, subscription checks, claimed-device cache membership, hardware-UID registration, device minting, or device limits.

Important board-class split:
- STM32 boards currently use the DFU-oriented update path.
- ESP32-S3 boards should use a separate serial flashing flow.
- The macOS app should not assume that all supported boards share one update-mode transport.

---

## 1) Project layout

- Xcode project: `macos/EMWaver/EMWaver.xcodeproj`
- App source root: `macos/EMWaver/EMWaver/`
- Tests:
  - `macos/EMWaver/EMWaverTests/`
  - `macos/EMWaver/EMWaverUITests/`
- Tools:
  - `macos/EMWaver/Tools/` (includes helper binaries/docs)

Entry points:
- `EMWaverApp.swift`
- `ContentView.swift`

---

## 2) Main code areas

## 2.1 Auth and account

`macos/EMWaver/EMWaver/Auth/`:
- local Agent API-key manager + model,
- keychain store,
- Agent API-key entry UI.

Auth UX rule:
- Agent API-key entry must remain available even when no EMWaver device is connected, so users can configure optional Agent replies independently of local hardware control.
- supported boards should enter local script/update workflows without a manual claim button or hosted registration step.
- native clients use a user-provided Agent API key and endpoint.
- the app stores the API key in Keychain and uses it as the bearer credential for the configured Agent endpoint.
- local scripts, flashing, and device control must not depend on this key.

## 2.2 Device + transport + host management

Core files include:
- `MacUSBManager.swift`
- `HostSessionManager.swift`
- `RemoteControlHostService.swift`

Responsibilities:
- local USB host operation,
- localhost gateway app-role integration,
- firmware update tooling for first-party setup on macOS without gating local script execution on account ownership.

Local-first gateway behavior:
- `RemoteControlHostService` can connect directly to the localhost gateway as `role=app`.
- Default local gateway URL is `ws://127.0.0.1:3921/v1/ws`.
- Override with `EMWAVER_LOCAL_GATEWAY_URL`.
- Disable local gateway connection with `EMWAVER_LOCAL_GATEWAY_DISABLED=1`.
- In local gateway mode, the macOS app owns `.emw` execution and USB/device transport; the gateway only forwards browser/CLI control messages.

Local Debug builds create a derived-data-only ESP helper wrapper from `tools/emwaver-esp-helper/emwaver_esp_helper.py` when PyInstaller is unavailable. Release packaging should still use a frozen helper bundle.

## 2.3 UI surfaces

Representative views:
- `SettingsView.swift`
- firmware/device connection sheets.

Agent configuration on macOS:
- local development loads repo-root `.env` into process environment at app startup,
- the macOS Agent interface/runtime calls the MGPT responses endpoint configured by `EMWAVER_AGENT_ENDPOINT` or `CONTINUAL_AGENT_ENDPOINT`,
- the shared Apple Agent client creates a persistent MGPT universe from stored prompt `emwaver-prompt` and then sends `universe` + `userInput`,
- provider selection, private prompts, tool policy, and metering belong server-side on MGPT,
- the macOS client should use a user-provided Agent API key stored locally/keychain-backed, and local scripts/hardware must work without it.

## 3) Firmware update, optional account setup, and tooling

Firmware update UI/logic:
- `FirmwareUpdateManager.swift`
- `FirmwareUpdateSheet.swift`

Tooling helper path:
- `macos/EMWaver/Tools/emwaver-dfu-helper`
- `macos/EMWaver/Tools/README.md`

The helper is bundled for update flows and should be version-synced with firmware/update expectations.

The macOS app bundles the canonical committed firmware image at `firmware/emwaver.bin`. Keep that file updated from the current STM32 ELF with `stm/update_firmware_bins.sh` whenever STM firmware changes.

Current macOS responsibility in this area:
- local script execution for connected supported boards without account/backend activation gates,
- first-party firmware setup/update flows for supported devices,
- local Agent key entry for optional Agent replies,
- avoid requiring supported-board hardware UID reads in Run Mode before local use,
- bundled or operator-selected custom firmware images,
- operator-readable progress and diagnostic logging for update sessions.

### Board-specific update model

STM32 update flow:
- run-mode connection over USB,
- if firmware is missing optional metadata commands, keep local control/update guidance independent of account registration,
- enter DFU/update mode from the app,
- flash through the DFU helper.

ESP32-S3 update flow:
- run-mode connection over USB remains separate from flashing,
- flashing is performed over the board's flash-capable USB serial port,
- the app should bundle a small helper based on `esptool` behavior,
- the app should use prebuilt firmware images rather than ESP-IDF project logic,
- manual bootloader entry is acceptable for the first shipping version on boards where automatic entry is unreliable,
- when an ESP32-S3 is connected, "Enter Update Mode" should present the BOOT/RESET sequence instead of sending the STM32 DFU opcode.

Explicit non-goal:
- do not bundle `idf.py` or the full ESP-IDF inside the macOS app.
- `idf.py` is a developer/build wrapper, not an end-user firmware update runtime.

What the macOS app should eventually do for ESP:
- detect available `/dev/cu.*` serial candidates,
- help the user identify the correct ESP flash port,
- present bootloader instructions when the board needs manual entry,
- invoke the bundled ESP flashing helper with bundled images and fixed offsets,
- return the user to Run Mode after flashing completes.

---

## 4) Shared code boundary

This app should consume shared reusable Apple logic from `/apple/EMWaverAppleCore`.

macOS folder should hold platform-specific host/UI integrations and desktop-specific behavior, not duplicated cross-platform script core logic.

---

## 5) Build/run

Open the macOS Xcode project and run the `EMWaver` scheme.

As with other app folders, avoid relying on Linux agent environment for native app compilation validation.

---

## 6) Contributor guardrails

1. Keep macOS-specific host UI and settings here; move shared logic to `/apple`.
2. Keep remote-control protocol compatibility aligned with the localhost gateway and other local clients.
3. Ensure firmware update helper integration remains stable when changing update flow.
4. Document any new app-level env/config toggles in this README.

---

## 7) Documentation maintenance rule

If you touch host management, firmware update flow, or auth/entitlement UX architecture in macOS app, update this README in the same PR.
