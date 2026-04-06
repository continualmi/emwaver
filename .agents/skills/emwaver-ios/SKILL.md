---
name: emwaver-ios
description: Use when working on the native EMWaver iOS app, including auth handoff, USB managers, script views, firmware asset integration, or deciding whether code belongs in /ios versus the shared /apple package.
---

# EMWaver iOS

Use this skill for work under [`/Users/luisml/continualmi/emwaver/ios`](/Users/luisml/continualmi/emwaver/ios).

## Read first

1. [`/Users/luisml/continualmi/emwaver/ios/README.md`](/Users/luisml/continualmi/emwaver/ios/README.md)
2. [`/Users/luisml/continualmi/emwaver/apple/README.md`](/Users/luisml/continualmi/emwaver/apple/README.md) if the change could be shared with macOS
3. [`/Users/luisml/continualmi/emwaver/AGENTS.md`](/Users/luisml/continualmi/emwaver/AGENTS.md) if product policy matters

## Where things live

- [`/Users/luisml/continualmi/emwaver/ios/EMWaver/EMWaverApp.swift`](/Users/luisml/continualmi/emwaver/ios/EMWaver/EMWaverApp.swift) and [`/Users/luisml/continualmi/emwaver/ios/EMWaver/ContentView.swift`](/Users/luisml/continualmi/emwaver/ios/EMWaver/ContentView.swift): app entry and top-level shell
- [`/Users/luisml/continualmi/emwaver/ios/EMWaver/Auth`](/Users/luisml/continualmi/emwaver/ios/EMWaver/Auth): sign-in state, handoff exchange, keychain-backed session work
- [`/Users/luisml/continualmi/emwaver/ios/EMWaver/Managers`](/Users/luisml/continualmi/emwaver/ios/EMWaver/Managers): USB transport, host sessions, remote control, device managers
- [`/Users/luisml/continualmi/emwaver/ios/EMWaver/Views`](/Users/luisml/continualmi/emwaver/ios/EMWaver/Views): app UI surfaces
- [`/Users/luisml/continualmi/emwaver/ios/EMWaver/firmware`](/Users/luisml/continualmi/emwaver/ios/EMWaver/firmware) and [`/Users/luisml/continualmi/emwaver/ios/EMWaver/ota`](/Users/luisml/continualmi/emwaver/ios/EMWaver/ota): bundled firmware payloads
- [`/Users/luisml/continualmi/emwaver/ios/EMWaver/Native`](/Users/luisml/continualmi/emwaver/ios/EMWaver/Native): native interop and buffer-related components
- [`/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore/Sources`](/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore/Sources): shared Apple transport, script runtime, storage, and UI modules

## Decision rules

- Keep iOS-specific UI and app state in `/ios`.
- Move reusable Apple logic into [`/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore`](/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore).
- The app should align with EMWaver-owned sign-in UX and shared `core` identity semantics from `continual-core`. Do not deepen product-local identity silos or reintroduce ad hoc direct-provider account ownership outside the shared `core` model.
- Keep transport and script runtime behavior aligned with firmware protocol contracts and existing Apple shared behavior.
- Treat `USBManager.swift`, `USBManager+ScriptDevice.swift`, `UsbMidiSysex.swift`, `HostSessionManager.swift`, and `RemoteControl*` as the first files for device and remote-control debugging.
- Auth work usually starts in `AuthenticationManager.swift`, `WebSignInHandoffSheet.swift`, and `KeychainStore.swift`.
- If the change touches script rendering, agent chat, cloud files, or shared storage semantics, inspect the Apple package before duplicating logic locally.
- When changing managers or auth flow, update [`/Users/luisml/continualmi/emwaver/ios/README.md`](/Users/luisml/continualmi/emwaver/ios/README.md).

## Common task routing

- App shell, navigation, or top-level state: [`/Users/luisml/continualmi/emwaver/ios/EMWaver/ContentView.swift`](/Users/luisml/continualmi/emwaver/ios/EMWaver/ContentView.swift)
- Sign-in and session restore: [`/Users/luisml/continualmi/emwaver/ios/EMWaver/Auth/AuthenticationManager.swift`](/Users/luisml/continualmi/emwaver/ios/EMWaver/Auth/AuthenticationManager.swift)
- USB or device communication: [`/Users/luisml/continualmi/emwaver/ios/EMWaver/Managers/USBManager.swift`](/Users/luisml/continualmi/emwaver/ios/EMWaver/Managers/USBManager.swift), [`/Users/luisml/continualmi/emwaver/ios/EMWaver/Managers/UsbMidiSysex.swift`](/Users/luisml/continualmi/emwaver/ios/EMWaver/Managers/UsbMidiSysex.swift)
- Remote host control: [`/Users/luisml/continualmi/emwaver/ios/EMWaver/Managers/HostSessionManager.swift`](/Users/luisml/continualmi/emwaver/ios/EMWaver/Managers/HostSessionManager.swift), [`/Users/luisml/continualmi/emwaver/ios/EMWaver/Views/RemoteHostControlView.swift`](/Users/luisml/continualmi/emwaver/ios/EMWaver/Views/RemoteHostControlView.swift)
- Shared script runtime or UI: [`/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore/Sources/EMWaverScriptRuntime`](/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore/Sources/EMWaverScriptRuntime), [`/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore/Sources/EMWaverScriptSwiftUI`](/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore/Sources/EMWaverScriptSwiftUI)

## Validation posture

- Prefer static review and targeted tests in the Xcode project when available.
- Do not assume this environment can run full iOS builds or simulator flows; note validation limits clearly.
