# macOS App (`/macos`)

Native macOS EMWaver application (Swift/SwiftUI + Xcode).

This is the desktop Apple host app for local USB workflows, remote host control, cloud/auth integrations, and firmware/update UX on macOS.

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
- sign-in sheets (including web handoff sheet).

## 2.2 Device + transport + host management

Core files include:
- `MacUSBManager.swift`
- `DeviceRegistryService.swift`
- `HostSessionManager.swift`
- `RemoteControlHostService.swift`
- `RemoteControlClientService.swift`
- `HostDirectory.swift`

Responsibilities:
- local USB host operation,
- remote attach/control pathways,
- host presence and cloud session integration.

## 2.3 UI surfaces

Representative views:
- `HostsView.swift`
- `RemoteHostControlView.swift`
- `SettingsView.swift`
- backend/frontend settings views
- firmware/device connection sheets.

## 2.4 Pro and entitlements

`Pro/EntitlementsManager.swift` + `ProUpgradeSheet.swift` integrate subscription/entitlement UX.

## 2.5 Security

`Security/EmwaverRootKey.swift` contains root-key handling for authenticity checks.

---

## 3) Firmware update and tooling

Firmware update UI/logic:
- `FirmwareUpdateManager.swift`
- `FirmwareUpdateSheet.swift`

Tooling helper path:
- `macos/EMWaver/Tools/emwaver-dfu-helper`
- `macos/EMWaver/Tools/README.md`

The helper is bundled for update flows and should be version-synced with firmware/update expectations.

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
3. Ensure firmware update helper integration remains stable when changing update flow.
4. Document any new app-level env/config toggles in this README.

---

## 7) Documentation maintenance rule

If you touch host management, firmware update flow, or auth/entitlement UX architecture in macOS app, update this README in the same PR.
