---
name: emwaver-general
description: Use when working anywhere in the EMWaver product and you need orientation on repo structure, platform rules, local-first product direction, Agent API boundaries, or how the app, firmware, gateway, daemon, and hardware folders fit together.
---

# EMWaver General

Use this skill before making EMWaver changes when the task spans multiple surfaces or when the product boundary is still unclear.

## Read first

1. [`/Users/luisml/continualmi/emwaver/AGENTS.md`](/Users/luisml/continualmi/emwaver/AGENTS.md)
2. [`/Users/luisml/continualmi/emwaver/README.txt`](/Users/luisml/continualmi/emwaver/README.txt)
3. The nearest folder README for the subsystem you will touch.
4. [`/Users/luisml/continualmi/PLANNING.md`](/Users/luisml/continualmi/PLANNING.md) if the task affects launch readiness, shared platform direction, or Continual MI/MGPT Agent API boundaries.

## Product model

- EMWaver is a local-first, open-source electronics platform, not a hardware-sales-first or cloud-gated product.
- Users should be able to install the app, connect a supported board, and start exploring without accounts, cloud activation, hosted relay, or firmware toolchains.
- Supported boards are managed targets. End users should not need manual firmware build or flash workflows.
- Cross-platform client surfaces are Android, iOS, macOS, Windows, plus the web app and headless daemon.
- EMWaver has host-backed and autonomous-device directions; do not assume every board behaves like a USB host-backed board forever.
- Do not gate local hardware access on accounts, subscriptions, hardware UID reads, device activation, minting, claiming, or backend device limits.
- Backend authority is only for the optional paid Agent API. Production Agent prompts, hidden `.emw` instruction packs, provider routing, and metering policy belong behind the future Continual MI/MGPT backend, not in this repo.

## Repo map

- [`/Users/luisml/continualmi/emwaver/web`](/Users/luisml/continualmi/emwaver/web): public site/docs/downloads surface trending toward static pages; existing auth/cloud/backend surfaces are migration debt
- [`/Users/luisml/continualmi/emwaver/gateway`](/Users/luisml/continualmi/emwaver/gateway): localhost browser control gateway for same-machine app control
- [`/Users/luisml/continualmi/emwaver/ios`](/Users/luisml/continualmi/emwaver/ios): iPhone/iPad app
- [`/Users/luisml/continualmi/emwaver/macos`](/Users/luisml/continualmi/emwaver/macos): desktop Apple app, local app-role bridge, and board-aware update surface
- [`/Users/luisml/continualmi/emwaver/apple`](/Users/luisml/continualmi/emwaver/apple): shared Apple package used by iOS and macOS
- [`/Users/luisml/continualmi/emwaver/android`](/Users/luisml/continualmi/emwaver/android): Android app
- [`/Users/luisml/continualmi/emwaver/windows`](/Users/luisml/continualmi/emwaver/windows): Windows 11 app
- [`/Users/luisml/continualmi/emwaver/daemon`](/Users/luisml/continualmi/emwaver/daemon): headless host runtime
- [`/Users/luisml/continualmi/emwaver/stm`](/Users/luisml/continualmi/emwaver/stm) and [`/Users/luisml/continualmi/emwaver/esp`](/Users/luisml/continualmi/emwaver/esp): firmware workspaces
- [`/Users/luisml/continualmi/emwaver/firmware`](/Users/luisml/continualmi/emwaver/firmware): committed firmware payloads consumed by apps
- [`/Users/luisml/continualmi/emwaver/crates`](/Users/luisml/continualmi/emwaver/crates): Rust helpers such as DFU tooling used by desktop flows
- [`/Users/luisml/continualmi/emwaver/tools`](/Users/luisml/continualmi/emwaver/tools): device-update helpers and related tooling
- [`/Users/luisml/continualmi/emwaver/assets/default-scripts`](/Users/luisml/continualmi/emwaver/assets/default-scripts): bundled example scripts shared across surfaces

## Working rules

- Always read the nearest folder README before changing that subsystem.
- Start with the narrowest platform skill that matches the task after using this general skill for orientation.
- Keep host-backed versus autonomous-board behavior distinct. Do not force one transport, update model, or cloud path onto all boards.
- Keep board classes distinct. STM32 DFU assumptions must not leak into ESP32-S3 flashing flows.
- Prefer shared logic in [`/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore`](/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore) instead of duplicating iOS and macOS behavior.
- Prefer committed firmware assets in [`/Users/luisml/continualmi/emwaver/firmware`](/Users/luisml/continualmi/emwaver/firmware) or per-app packaged copies over ad hoc build artifacts.
- When behavior changes, update the relevant README in the same change.
- If a task touches auth, billing, entitlements, device identity, or cloud sync, treat that surface as migration debt unless it is clearly part of the optional Agent API boundary.
- The current web/backend data layer is transitional. Avoid deepening `.data`-style cloud persistence unless the task is explicitly about retiring or isolating it.

## First places to inspect

- Web/static migration or Agent API issue: [`/Users/luisml/continualmi/emwaver/web/src/server`](/Users/luisml/continualmi/emwaver/web/src/server), [`/Users/luisml/continualmi/emwaver/web/src/app/v1`](/Users/luisml/continualmi/emwaver/web/src/app/v1)
- Apple shared script or transport issue: [`/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore/Sources`](/Users/luisml/continualmi/emwaver/apple/EMWaverAppleCore/Sources)
- iOS app-specific issue: [`/Users/luisml/continualmi/emwaver/ios/EMWaver`](/Users/luisml/continualmi/emwaver/ios/EMWaver)
- macOS local bridge, update, or host issue: [`/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver`](/Users/luisml/continualmi/emwaver/macos/EMWaver/EMWaver)
- Android transport or scripting issue: [`/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver/emwaverandroidapp`](/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver/emwaverandroidapp)
- Windows parity or firmware issue: [`/Users/luisml/continualmi/emwaver/windows/EMWaver`](/Users/luisml/continualmi/emwaver/windows/EMWaver)
- Firmware protocol or payload issue: [`/Users/luisml/continualmi/emwaver/stm`](/Users/luisml/continualmi/emwaver/stm), [`/Users/luisml/continualmi/emwaver/esp`](/Users/luisml/continualmi/emwaver/esp), [`/Users/luisml/continualmi/emwaver/firmware`](/Users/luisml/continualmi/emwaver/firmware)

## Cross-repo context

- Hardware line repos such as `emwaver-air`, `emwaver-core`, `emwaver-link`, `emwaver-shield`, `gpio-waver`, `infrared-waver`, `ism-waver`, and `rfid-waver` own board assets and manufacturing-facing docs.
- Use those repos for hardware-resource links or board-specific assets. Use the main `emwaver` repo for product software, runtime behavior, and customer-facing flows.

## Validation posture

- Prefer documentation-aligned code review first, then the narrowest platform-native validation that matches the change.
- Native builds and real device tests usually need the correct workstation and hardware; call out when validation is partial.
