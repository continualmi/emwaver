---
name: emwaver-android
description: Use when working on the native EMWaver Android app, including USB transport, connection lifecycle, scripting UI, app resources, or firmware asset packaging for STM32 and ESP32-S3 boards.
---

# EMWaver Android

Use this skill for work under [`/Users/luisml/continualmi/emwaver/android`](/Users/luisml/continualmi/emwaver/android).

## Read first

1. [`/Users/luisml/continualmi/emwaver/android/README.md`](/Users/luisml/continualmi/emwaver/android/README.md)
2. [`/Users/luisml/continualmi/emwaver/AGENTS.md`](/Users/luisml/continualmi/emwaver/AGENTS.md)

## Where things live

- [`/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver`](/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver): Java source
- [`/Users/luisml/continualmi/emwaver/android/app/src/main/res`](/Users/luisml/continualmi/emwaver/android/app/src/main/res): layouts, menus, themes, drawables, device filter XML
- [`/Users/luisml/continualmi/emwaver/android/app/src/main/assets/firmware`](/Users/luisml/continualmi/emwaver/android/app/src/main/assets/firmware): STM payloads
- [`/Users/luisml/continualmi/emwaver/android/app/src/main/assets/ota`](/Users/luisml/continualmi/emwaver/android/app/src/main/assets/ota): ESP payloads
- [`/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver/emwaverandroidapp/agent`](/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver/emwaverandroidapp/agent): legacy Agent/MGPT runtime targeted for removal
- [`/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver/emwaverandroidapp/scripts`](/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver/emwaverandroidapp/scripts): script engine, model, plot buffers, render tree
- [`/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver/emwaverandroidapp/ui`](/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver/emwaverandroidapp/ui): app screens, dialogs, and fragments

## High-value files

- `MainActivity.java`
- `UsbMidiSysex.java`
- `USBService.java`
- `DeviceConnectionManager.java`
- `DeviceConnectionService.java`
- `CommandSender.java`
- `agent/AgentEndpointApi.java`
- `ui/agent/AgentChatBottomSheetDialogFragment.java`
- `agent/AgentApiKeyStore.java`
- `scripts/ScriptEngine.java`
- `scripts/ScriptRenderView.java`
- `ui/emwaver/UpdateDeviceDialogFragment.java`

## Decision rules

- Keep USB discovery and runtime paths compatible with both STM32 and ESP32-S3 boards.
- Android shares the USB run-mode path for both board classes, but Android does not yet ship the ESP-native flashing flow. Do not route ESP boards into STM32 DFU.
- Treat `ui/flash/Dfu.java` and `ui/emwaver/UpdateDeviceDialogFragment.java` as STM32-oriented until Android gains the explicit ESP flashing path.
- Local scripts and local hardware control must not require accounts, cloud activation, hosted relay, sync, hardware UID gates, or subscription checks.
- Remove Agent/MGPT access from Android; do not add Android-only account, cloud file sync, or hosted remote-control assumptions.
- Script-runtime changes should stay compatible with other surfaces that render `.emw` scripts, especially Windows and the Apple shared package.
- Keep resource-layer dialogs and settings aligned with actual feature availability.
- When transport, connection lifecycle, or update UX changes, update [`/Users/luisml/continualmi/emwaver/android/README.md`](/Users/luisml/continualmi/emwaver/android/README.md).

## Common task routing

- USB/device lifecycle: [`/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver/emwaverandroidapp/UsbMidiSysex.java`](/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver/emwaverandroidapp/UsbMidiSysex.java), [`/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver/emwaverandroidapp/DeviceConnectionManager.java`](/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver/emwaverandroidapp/DeviceConnectionManager.java)
- Script engine or rendering: [`/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver/emwaverandroidapp/scripts/ScriptEngine.java`](/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver/emwaverandroidapp/scripts/ScriptEngine.java), [`/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver/emwaverandroidapp/scripts/ScriptRenderView.java`](/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver/emwaverandroidapp/scripts/ScriptRenderView.java)
- Agent/MGPT removal: [`/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver/emwaverandroidapp/agent`](/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver/emwaverandroidapp/agent) and [`/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver/emwaverandroidapp/ui/agent`](/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver/emwaverandroidapp/ui/agent)
- Screen or dialog issue: [`/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver/emwaverandroidapp/ui`](/Users/luisml/continualmi/emwaver/android/app/src/main/java/com/emwaver/emwaverandroidapp/ui)

## Validation posture

- Prefer Gradle compile or focused source review when practical.
- Real USB host testing requires physical-device validation; call that out if not performed.
