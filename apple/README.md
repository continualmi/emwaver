# Apple Shared Core (`/apple`)

Shared Swift package used by both iOS and macOS EMWaver apps.

This folder is where cross-platform Apple logic lives so iOS/macOS can share script runtime, transport abstractions, storage sync, and common UI components.

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

Low-level transport layer abstractions for USB MIDI SysEx device communication.

Key file:
- `Sources/EMWaverTransport/UsbMidiSysex.swift`

## 2.2 `EMWaverScriptModel`

Shared script data/model types.

Key file:
- `Sources/EMWaverScriptModel/ScriptTypes.swift`

## 2.3 `EMWaverScriptRuntime`

Script execution/runtime support and related infrastructure.

Representative files:
- `ScriptEngine.swift`
- `ScriptDevice.swift`
- `ScriptPreviewManager.swift`
- `PlotBufferStore.swift`
- `RustBufferCore.swift` (interop surface)

## 2.4 `EMWaverScriptSwiftUI`

SwiftUI rendering components for script UI and plotting.

Representative files:
- `ScriptRenderView.swift`
- `ScriptPlotView.swift`

## 2.5 `EMWaverScriptStorage`

Storage and cloud sync helpers for scripts/signals/user files.

Representative files:
- `CloudFilesAPI.swift`
- `CloudSyncEngine.swift`
- `CloudSyncStateStore.swift`
- `FileService.swift`
- metadata and support models

## 2.6 `EMWaverScriptsUI`

Higher-level shared UI for script workflows, code editor, and agent chat integrations.

Representative files:
- `ScriptsRootView.swift`
- `EmwCodeEditor.swift`
- `SignalViewerView.swift`
- `AgentChat*` files
- `AgentCloudAPI.swift`

Agent configuration direction:
- the Apple shared Agent UI now uses one managed tool-calling agent mode,
- model config is loaded from app environment variables such as `MODEL_NAME`, `MODEL_BASE_URL`, `MODEL_API_KEY`, and `MODEL_REQUEST_TIMEOUT_MS`,
- the package should not depend on end-user provider login flows or free-form API key entry in the UI.

Also bundles package resources, including firmware payload under:
- `Resources/Firmware/emwaver.bin`

---

## 3) Why this package exists

Without this package, iOS and macOS would diverge quickly in:
- script model/runtime behavior,
- cloud sync semantics,
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
