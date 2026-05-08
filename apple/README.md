# Apple Shared Core (`/apple`)

Shared Swift package used by both iOS and macOS EMWaver apps.

This folder is where cross-platform Apple logic lives so iOS/macOS can share script runtime, transport abstractions, local storage, and common UI components.

---

## 1) Package overview

Swift Package: `apple/EMWaverAppleCore/Package.swift`

Supported platforms:
- iOS 17+
- macOS 13+

Published internal library targets:
- `EMWaverTransport`
- `EMWaverScriptModel`
- `EMWaverScriptSwiftUI`
- `EMWaverScriptRuntime`
- `EMWaverScriptStorage`
- `EMWaverScriptsUI`

---

## 2) Target responsibilities

## 2.1 `EMWaverTransport`

 Low-level transport layer abstractions for EMWaver device communication.

Key file:
- `Sources/EMWaverTransport/UsbMidiSysex.swift` — shared EMWaver SysEx/superframe codec used by USB MIDI and ESP32 BLE transports.

## 2.2 `EMWaverScriptModel`

Shared script data/model types.

Key file:
- `Sources/EMWaverScriptModel/ScriptTypes.swift`

## 2.3 `EMWaverScriptRuntime`

Script execution/runtime support and related infrastructure.

Representative files:
- `ScriptEngine.swift`
- `ScriptDevice.swift`
- `SimulatorScriptDevice.swift`
- `ScriptPreviewManager.swift`
- `PlotBufferStore.swift`
- `RustBufferCore.swift` (interop surface)

`SimulatorScriptDevice` is the shared iOS/macOS test adapter for `simulator/fixtures/*.json`. It implements `ScriptDevice` so Apple runtime tests can execute hardware-touching `.emw` scripts without a physical board.

## 2.4 `EMWaverScriptSwiftUI`

SwiftUI rendering components for script UI and plotting.

Representative files:
- `ScriptRenderView.swift`
- `ScriptPlotView.swift`

## 2.5 `EMWaverScriptStorage`

Local storage helpers for scripts/signals/user files.

Representative files:
- `FileService.swift`
- metadata and support models

## 2.6 `EMWaverScriptsUI`

Higher-level shared UI for script workflows, code editor, and agent chat integrations.

Representative files:
- `ScriptsRootView.swift`
- `EmwCodeEditor.swift`
- `SignalViewerView.swift`
- `AgentChat*` files

`ScriptsRootView` supports an optional host-provided script run hook. macOS uses this to create local script sessions outside the shared single-preview manager while iOS keeps the default single-preview behavior.

Agent configuration direction:
- the Apple shared Agent UI uses a host-provided Agent endpoint plus user-provided API key,
- app clients call the MGPT stateful Responses API for Agent chat,
- on first Agent send, the shared UI creates a persistent universe from the server-side stored prompt `emwaver-prompt`,
- subsequent turns send only `universe` and `userInput` to MGPT,
- the package should keep the Agent runtime/interface, collect local script/device/UI/error context, and authenticate with an API key stored locally/keychain-backed by the host app,
- the package must not bundle production Agent prompts, private `.emw` instructions, provider routing, or metering policy.

Also bundles package resources, including firmware payload under:
- `Resources/Firmware/emwaver.bin`

---

## 3) Why this package exists

Without this package, iOS and macOS would diverge quickly in:
- script model/runtime behavior,
- local storage semantics,
- transport behavior,
- UI component behavior.

Keeping shared logic here reduces drift and keeps behavior parity across Apple platforms.

---

## 4) Integration points

This package is consumed by:
- `/ios` app project
- `/macos` app project

If API/ABI shape changes here, both apps may require coordinated updates.

---

## 5) Contributor guardrails

1. Prefer adding shared logic here rather than duplicating in iOS/macOS app folders.
2. Keep target boundaries clean (model/runtime/storage/UI split).
3. Be explicit when introducing platform-specific behavior in shared code.
4. When changing shared APIs, verify both iOS and macOS compile paths.

---

## 6) Documentation maintenance rule

For any changes to package target responsibilities or public APIs, update this README in same PR and note impacted consumers (`/ios`, `/macos`).
