# iOS App (`/ios`)

Native iOS EMWaver application (Swift/SwiftUI + Xcode project).

This app provides mobile UX for EMWaver device control, scripts, remote host workflows, cloud sync/auth, and firmware asset integration.

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
- sign-in state,
- Firebase token handling,
- secure local persistence.

## 2.2 Device and transport managers

`ios/EMWaver/Managers/`:
- `USBManager.swift`
- `USBManager+ScriptDevice.swift`
- `UsbMidiSysex.swift`
- host/remote managers (`HostSessionManager`, `RemoteControl*`)
- cloud config / host directory helpers.

Responsibilities:
- USB MIDI SysEx device communication,
- runtime host session behavior,
- remote control integration,
- sampler-compatible script transport behavior for built-in scripts like `sampler.emw`, including continuous all-zero stream-lane capture during active sampling.

## 2.3 Views

`ios/EMWaver/Views/`:
- scripts container,
- remote host control view,
- cloud/host sheets.

## 2.4 Security

`ios/EMWaver/Security/EmwaverRootKey.swift`:
- root key usage for authenticity-related verification paths.

---

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

Google sign-in config is bundled at build time from repo env files:
- repo-root `.env` for local/debug builds
- repo-root `.env.prod` for release-oriented builds

The iOS target writes a generated `EMWaverEnv.plist` into the app bundle and patches the built app `Info.plist` with the Google callback URL scheme. Scheme environment variables still override bundled values when present.

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
