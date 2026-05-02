# iOS App (`/ios`)

Native iOS EMWaver application (Swift/SwiftUI + Xcode project).

This app provides mobile UX for EMWaver device control, scripts, optional Agent assistance, optional hosted migration surfaces, and firmware asset integration.

---

## 1) Project layout

- Xcode project: `ios/EMWaver.xcodeproj`
- App source root: `ios/EMWaver/`
- Tests:
  - `ios/EMWaverTests/`
  - `ios/EMWaverUITests/`

Key app entry:
- `EMWaverApp.swift`
- `ContentView.swift`

---

## 2) Main code areas

## 2.1 Auth

`ios/EMWaver/Auth/`:
- `AuthenticationManager.swift`
- `FirebaseAuthService.swift`
- `GoogleOAuthSignInProvider.swift`
- `KeychainStore.swift`
- `SignInSheet.swift`

Responsibilities:
- local Agent API-key persistence for optional Agent replies,
- secure local persistence for the remaining hosted/session data still present in the app.

Current guidance:
- the old web handoff-code sheet has been removed from iOS,
- the visible key sheet stores a user-provided Agent API key locally,
- local scripts and hardware control must not depend on this key.

## 2.2 Device and transport managers

`ios/EMWaver/Managers/`:
- `USBManager.swift`
- `USBManager+ScriptDevice.swift`
- `UsbMidiSysex.swift`
- optional hosted host/remote managers (`HostSessionManager`, `RemoteControl*`)
- cloud config / host directory helpers.

Responsibilities:
- USB device communication,
- optional hosted host session behavior,
- optional hosted remote control integration,
- sampler-compatible script transport behavior for built-in scripts like `sampler.emw`, including continuous all-zero stream-lane capture during active sampling.

## 2.3 Views

`ios/EMWaver/Views/`:
- scripts container,
- optional remote host control view,
- cloud/host sheets.

## 3) Bundled firmware assets

- `ios/EMWaver/firmware/emwaver.bin`
- `ios/EMWaver/ota/emwaveresp.bin`

These are repo-managed payloads synced by firmware update tooling and consumed by update flows.

---

## 4) Native interop note

- `ios/EMWaver/Managers/NativeBufferRust.swift`
- `ios/EMWaver/Native/README.md`

Interop/legacy native-buffer components exist; keep usage aligned with current product direction and avoid introducing new hard dependencies without explicit decision.

---

## 5) Build and run

Open `ios/EMWaver.xcodeproj` in Xcode and run the `EMWaver` scheme on simulator/device.

The iOS Agent key sheet stores a user-provided Agent API key locally in Keychain. Agent calls require `EMWAVER_AGENT_ENDPOINT` or `CONTINUAL_AGENT_ENDPOINT`; local device/script use does not.

Release/debug environment still controls the backend and platform base URLs through the generated `EMWaverEnv.plist`. Scheme environment variables override bundled values when present.

Hosted host-session UI/heartbeat and hosted remote-control WebSocket behavior are disabled by default. Set `EMWAVER_HOSTED_SERVICES_UI_ENABLED=1` to expose the hosted host directory/presence surfaces, and `EMWAVER_HOSTED_REMOTE_CONTROL_ENABLED=1` to allow the legacy hosted `/v1/ws` remote-control host path. Local device/script use must not depend on either flag.

Do not assume CI/agent environment can run full iOS builds; validate on proper macOS/Xcode setup.

---

## 6) Contributor guardrails

1. Keep iOS-specific UI/state logic in `/ios`, move reusable logic to `/apple` package.
2. Keep transport behavior compatible with firmware protocol contracts.
3. Keep auth/token handling and secure storage paths explicit and reviewed.
4. Update tests when changing managers used by device/transport.

---

## 7) Documentation maintenance rule

When changing manager responsibilities, auth flows, or firmware asset paths, update this README in same PR.
