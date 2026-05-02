# macOS App (`/macos`)

Native macOS EMWaver application (Swift/SwiftUI + Xcode).

This is the desktop Apple host app for local USB workflows, remote host control, cloud/auth integrations, and firmware/update UX on macOS.

It is now the canonical desktop surface for device activation and firmware provisioning on macOS: the app reads the board hardware UID, silently restores/syncs backend access for `board_type + hardware_uid`, flashes managed firmware, and keeps local device access aligned with that registration model.

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
- authentication manager + models,
- Firebase auth service,
- Google OAuth provider,
- keychain store,
- API key entry and account-link UI.

Auth UX rule:
- API key entry must remain available even when no EMWaver device is connected, so new users can link the app before flashing a supported board.
- once a supported board reconnects with readable `board_type + hardware_uid`, the app should restore/sync it automatically instead of requiring a manual claim button.
- native clients now use an EMWaver API key created on the web account page and pasted into the app.
- the app stores the API key in Keychain and uses it as the bearer credential for `/v1/*` routes.
- app startup should wait for the initial keychain-backed credential restore to finish before the first entitlement-gated refreshes, so a persisted keyed account does not briefly downgrade to local-only UI after relaunch.

## 2.2 Device + transport + host management

Core files include:
- `MacUSBManager.swift`
- `HostSessionManager.swift`
- `RemoteControlHostService.swift`
- `RemoteControlClientService.swift`
- `HostDirectory.swift`

Responsibilities:
- local USB host operation,
- remote attach/control pathways,
- host presence and cloud session integration,
- hardware-UID-backed claim awareness,
- activation/provision handoff into DFU update tooling for first-party setup on macOS.

Local-first gateway behavior:
- `RemoteControlHostService` can connect directly to the localhost gateway as `role=app`.
- Default local gateway URL is `ws://127.0.0.1:3921/v1/ws`.
- Override with `EMWAVER_LOCAL_GATEWAY_URL`.
- Disable local gateway connection with `EMWAVER_LOCAL_GATEWAY_DISABLED=1` to fall back to the hosted remote-control socket path.
- In local gateway mode, the macOS app owns `.emw` execution and USB/device transport; the gateway only forwards browser/CLI control messages.

Local Debug builds create a derived-data-only ESP helper wrapper from `tools/emwaver-esp-helper/emwaver_esp_helper.py` when PyInstaller is unavailable. Release packaging should still use a frozen helper bundle.

## 2.3 UI surfaces

Representative views:
- `HostsView.swift`
- `RemoteHostControlView.swift`
- `SettingsView.swift`
- firmware/device connection sheets.

## 2.4 Pro and entitlements

`Pro/EntitlementsManager.swift` + `ProUpgradeSheet.swift` integrate subscription/entitlement UX.

Billing/account authority rule:
- `Continual Pro` is the canonical paid plan.
- older `EMWaver Pro` strings in local UI should be treated as migration-era copy and updated toward `Continual Pro`.

Agent configuration on macOS:
- local development loads repo-root `.env` into process environment at app startup,
- the Agent should call the managed EMWaver backend `/v1/agent/*` routes, with provider selection, tool loops, and metering owned server-side,
- the macOS Agent UI should not require Codex login flows or manual provider API key entry.

## 3) Firmware update, activation, and tooling

Firmware update UI/logic:
- `FirmwareUpdateManager.swift`
- `FirmwareUpdateSheet.swift`

Tooling helper path:
- `macos/EMWaver/Tools/emwaver-dfu-helper`
- `macos/EMWaver/Tools/README.md`

The helper is bundled for update flows and should be version-synced with firmware/update expectations.

The macOS app bundles the canonical committed firmware image at `firmware/emwaver.bin`. Keep that file updated from the current STM32 ELF with `stm/update_firmware_bins.sh` whenever STM firmware changes.

Current macOS responsibility in this area:
- first-party restore/sync + provision flow for supported devices,
- backend-tethered activation using `/provisioning/mint` with `board_type + hardware_uid`,
- account key entry plus web-managed key creation/replacement on the EMWaver frontend,
- device access governed by account subscription entitlements and allowed device counts rather than per-device purchases,
- reading supported-board hardware UID in Run Mode before activation,
- unified in-app device list with local cache fallback for Offline Mode,
- bundled or operator-selected custom firmware images,
- operator-readable progress and diagnostic logging for provisioning/update sessions.

### Board-specific update model

STM32 update flow:
- run-mode connection over USB,
- if firmware is missing the hardware UID command, immediately prompt the user to enter the managed update flow,
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
2. Keep remote-control protocol compatibility aligned with backend and other clients.
3. Ensure firmware update helper integration remains stable when changing update or activation flow.
4. Document any new app-level env/config toggles in this README.

---

## 7) Documentation maintenance rule

If you touch host management, firmware update flow, or auth/entitlement UX architecture in macOS app, update this README in the same PR.
