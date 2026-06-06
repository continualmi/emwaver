---
name: emwaver-ios
description: Use when working on the native EMWaver iOS app, including local USB managers, script views, Agent/MGPT removal, firmware asset integration, or deciding whether code belongs in /ios versus the shared /apple package.
---

# EMWaver iOS

Use this skill for work under [`/Users/luisml/continualmi/emwaver/ios`](/Users/luisml/continualmi/emwaver/ios).

## Read first

1. [`/Users/luisml/continualmi/emwaver/ios/README.md`](/Users/luisml/continualmi/emwaver/ios/README.md)
2. [`/Users/luisml/continualmi/emwaver/apple/README.md`](/Users/luisml/continualmi/emwaver/apple/README.md) if the change could be shared with macOS
3. [`/Users/luisml/continualmi/emwaver/AGENTS.md`](/Users/luisml/continualmi/emwaver/AGENTS.md) if product policy matters

## Where things live

- [`/Users/luisml/continualmi/emwaver/ios/EMWaver/EMWaverApp.swift`](/Users/luisml/continualmi/emwaver/ios/EMWaver/EMWaverApp.swift) and [`/Users/luisml/continualmi/emwaver/ios/EMWaver/ContentView.swift`](/Users/luisml/continualmi/emwaver/ios/EMWaver/ContentView.swift): app entry and top-level shell
- [`/Users/luisml/continualmi/emwaver/ios/EMWaver/Auth`](/Users/luisml/continualmi/emwaver/ios/EMWaver/Auth): legacy Agent API key/session helpers targeted for removal
- [`/Users/luisml/continualmi/emwaver/ios/EMWaver/Managers`](/Users/luisml/continualmi/emwaver/ios/EMWaver/Managers): USB transport, local script/device managers, and legacy host/remote-control surfaces
- [`/Users/luisml/continualmi/emwaver/ios/EMWaver/Views`](/Users/luisml/continualmi/emwaver/ios/EMWaver/Views): app UI surfaces
- [`/Users/luisml/continualmi/emwaver/firmware`](/Users/luisml/continualmi/emwaver/firmware): canonical shared firmware payloads (sourced into the iOS bundle via Xcode folder reference)
- [`/Users/luisml/continualmi/emwaver/ios/EMWaver/Native`](/Users/luisml/continualmi/emwaver/ios/EMWaver/Native): native interop and buffer-related components
- [`/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore/Sources`](/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore/Sources): shared Apple transport, script runtime, storage, and UI modules

## Decision rules

- Keep iOS-specific UI and app state in `/ios`.
- Move reusable Apple logic into [`/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore`](/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore).
- Local scripts and local hardware control must not require accounts, cloud activation, hosted relay, sync, hardware UID gates, or subscription checks.
- In-app Agent UI/MGPT clients are being removed; iOS keeps local script import/app-local execution and does not host MCP.
- Keep transport and script runtime behavior aligned with firmware protocol contracts and existing Apple shared behavior.
- Treat `USBManager.swift`, `USBManager+ScriptDevice.swift`, and `UsbMidiSysex.swift` as the first files for local device debugging.
- Agent removal usually starts in `AuthenticationManager.swift`, any remaining keychain helpers, and shared Apple Agent UI.
- If the change touches script rendering, agent chat, or shared storage semantics, inspect the Apple package before duplicating logic locally.
- When changing managers or Agent-key/session flow, update [`/Users/luisml/continualmi/emwaver/ios/README.md`](/Users/luisml/continualmi/emwaver/ios/README.md).

## Common task routing

- App shell, navigation, or top-level state: [`/Users/luisml/continualmi/emwaver/ios/EMWaver/ContentView.swift`](/Users/luisml/continualmi/emwaver/ios/EMWaver/ContentView.swift)
- Agent removal work: [`/Users/luisml/continualmi/emwaver/ios/EMWaver/Auth/AuthenticationManager.swift`](/Users/luisml/continualmi/emwaver/ios/EMWaver/Auth/AuthenticationManager.swift) and shared Apple Agent UI files
- USB or device communication: [`/Users/luisml/continualmi/emwaver/ios/EMWaver/Managers/USBManager.swift`](/Users/luisml/continualmi/emwaver/ios/EMWaver/Managers/USBManager.swift), [`/Users/luisml/continualmi/emwaver/ios/EMWaver/Managers/UsbMidiSysex.swift`](/Users/luisml/continualmi/emwaver/ios/EMWaver/Managers/UsbMidiSysex.swift)
- Remote host control: [`/Users/luisml/continualmi/emwaver/ios/EMWaver/Managers/HostSessionManager.swift`](/Users/luisml/continualmi/emwaver/ios/EMWaver/Managers/HostSessionManager.swift), [`/Users/luisml/continualmi/emwaver/ios/EMWaver/Views/RemoteHostControlView.swift`](/Users/luisml/continualmi/emwaver/ios/EMWaver/Views/RemoteHostControlView.swift)
- Shared script runtime or UI: [`/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore/Sources/EMWaverScriptRuntime`](/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore/Sources/EMWaverScriptRuntime), [`/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore/Sources/EMWaverScriptSwiftUI`](/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore/Sources/EMWaverScriptSwiftUI)

## Validation posture

- Prefer static review and targeted tests in the Xcode project when available.
- Do not assume this environment can run full iOS builds or simulator flows; note validation limits clearly.
