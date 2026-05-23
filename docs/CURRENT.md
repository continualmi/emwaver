# EMWaver — Current State

This is the orientation doc for the repo as it exists today. Read this first.

## What EMWaver Is

EMWaver is a **local-first, open-source, AI-assisted electronics platform** by Continual MI. It turns supported MCU boards (STM32, ESP32-S3) into a scriptable hardware lab through native apps, managed firmware, and optional Agent assistance.

- **No accounts required** for local hardware control.
- **No cloud activation, hosted relay, or subscription** for core use.
- **Paid Agent API** is optional and is the primary business model.

## Supported Platforms

| Platform | Surface | V1 Priority | Status |
|----------|---------|-------------|--------|
| iOS | Native SwiftUI app | **Primary** | Active (TestFlight / store) |
| Android | Native Kotlin app | **Primary** | Active (APK preview) |
| macOS | Native SwiftUI app | Dev/Advanced | Active |
| Windows | Native WinUI 3 app | Deferred | Source exists; build blocked on this machine |

V1 is mobile-first. The phone is the tricorder — the device users always carry. The Agent is the interface; users don't need a desktop editor if the Agent writes and debugs scripts. macOS stays as the development surface for firmware flashing and multi-device bench work. Windows is deferred past V1.

## What Was Removed (May 2026)

The Gateway, CLI, browser UI, and Linux support were removed. See `docs/DROP_GATEWAY_AND_LINUX.md` for the full decision record.

In short: the Gateway was a three-layer architecture (browser → Node.js relay → Rust daemon → hardware) that was fundamentally unstable. It existed to paper over the absence of a native Linux app. Linux usage was negligible. The CLI's remaining use case (agent-driven scripting) is now built into the native apps.

Archived Gateway-era docs are in `docs/archive/`.

## Repo Layout

```
emwaver/
├── android/          Native Android app (Kotlin, Gradle)
├── ios/              Native iOS app (Swift, SwiftUI)
├── macos/            Native macOS app (Swift, SwiftUI)
├── windows/          Native Windows app (C#, WinUI 3)
├── apple/            Shared Swift package (macOS + iOS)
├── stm/              STM32 firmware workspace
├── esp/              ESP32 firmware workspace
├── firmware/         Bundled firmware payloads per board
├── crates/           Rust crates (emwaver-dfu, emwaver-dfu-helper)
├── simulator/        Shared device simulator fixtures
├── hardware/         Imported hardware design repos
├── web/              Public static website (emwaver.ai)
├── tools/            ESP helper and build tooling
├── videos/           Promo video planning
├── docs/             Project docs (see below)
├── .agents/skills/   Codex skills for repo-local guidance
└── scripts/          Build/validation scripts
```

## Key Docs

| Doc | Purpose |
|-----|---------|
| `AGENTS.md` | Repo-wide vision, platform policies, doc map |
| `docs/CURRENT.md` | This file — current-state orientation |
| `docs/DROP_GATEWAY_AND_LINUX.md` | Decision record for Gateway/CLI/Linux removal |
| `docs/PLANNING.md` | Active priorities, blockers, next steps |
| `docs/SCHEDULE.md` | Weekly execution tracker |
| `docs/TESTS.md` | Manual hardware test suite |
| `docs/AGENT_API.md` | Agent API contract and client integration |
| `docs/AGENT_EVAL_RUNTIME.md` | Hardware primitive tools (current agent model) |
| `docs/CROSS_PLATFORM_AGENT_UI_MIGRATION_PLAN.html` | Cross-platform Agent/UI parity plan |
| `docs/SIMULATOR.md` | Shared device simulator |
| `docs/parity/` | Cross-platform feature parity contracts |

## Stale Docs — Needs Updates

These docs are directionally valid but contain references to the removed Gateway/CLI/Linux. They should be updated in a follow-up pass:

- `docs/ESP32_WIFI_REMOTE_ACCESS.md` — has Gateway references
- `docs/ESP32_WIFI_TRANSPORT_PLAN.md` — has Gateway references
- `docs/MACOS_MULTI_DEVICE_PLAN.md` — has Gateway references
- `docs/MACOS_SCRIPT_SESSIONS_UI.md` — has Gateway references
- `docs/TRANSPORT_SESSION_ISOLATION_PLAN.md` — has Gateway references
- `docs/TESTS.md` — has Gateway references in transport validation notes

## Windows Development Note

Windows is deferred past V1. The source exists and the parity contracts (`docs/parity/`) document the feature requirements, but the WinUI 3 app requires a Windows 11 workstation with Visual Studio 2022 that is not available on this machine. Windows will be revisited after V1 launch.
