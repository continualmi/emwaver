# Android App (`/android`)

Native Android EMWaver application (Gradle project, Java/Kotlin-style Android app structure).

This app provides mobile EMWaver device workflows: USB MIDI communication, scripting surfaces, settings, host/remote control UI, auth/cloud dialogs, and firmware asset packaging.

---

## 1) Project layout

Gradle root:
- `android/build.gradle`
- `android/settings.gradle`
- `android/gradle.properties`

App module:
- `android/app/`
  - manifest, resources, Java source, assets.

Entry/activity files include:
- `MainActivity.java`
- `WelcomeActivity.java`
- `SettingsActivity.java`

---

## 2) Main code areas

Located under `android/app/src/main/java/com/emwaver/emwaverandroidapp/`.

Key components:
- `UsbMidiSysex.java` — USB MIDI SysEx transport logic.
- `USBService.java` / `USBManager-like services` — device connection plumbing.
- `DeviceConnectionManager.java` / `DeviceConnectionService.java` — connection lifecycle.
- `CommandSender.java` — command dispatch path.
- `NativeBuffer.java` — native/buffer integration surface.
- `scripts/ScriptEngine.java` + `scripts/ScriptRenderView.java` — Rhino bridge + native script UI rendering (including Sampler buffer bridges and native `UI.plot` waveform rendering for `sampler.emw` parity).
- Activities for primary UX and settings.

---

## 3) UI/resources

`android/app/src/main/res/` includes:
- activity/fragment/dialog layouts,
- drawable icons/resources,
- menus/navigation,
- values/themes/colors/strings,
- USB device filter XML.

Notable UX coverage reflected by resources:
- script lists/editor dialogs,
- host sheet/remote host control activity,
- agent chat dialogs,
- sign-in + sync dialogs,
- device update dialogs.

---

## 4) Bundled firmware assets

Firmware payloads in app assets:
- `android/app/src/main/assets/firmware/emwaver.bin`
- `android/app/src/main/assets/ota/emwaveresp.bin`

These are updated by repo firmware tooling and consumed by update flows.

---

## 5) Build/run (developer machine)

Typical flow:

```bash
cd android
./gradlew assembleDebug
```

or run from Android Studio.

Use the appropriate connected device/emulator setup (USB host behavior testing needs real device support).

---

## 6) Guardrails

1. Keep transport compatibility aligned with firmware protocol (fixed-size packet model).
2. Keep Android USB discovery aligned with both STM32 and ESP32-S3 EMWaver runtime descriptors; do not hard-code STM32-only identity assumptions in the runtime path.
3. Keep firmware asset paths stable unless coordinated across tooling and update flows.
4. Keep app-level dialogs/resources synced with underlying feature availability.
5. Avoid introducing platform-specific divergence where shared behavior can be aligned with iOS/macOS/web patterns.

Current Android board split:
- STM32 runtime uses USB MIDI SysEx and can enter the DFU-based update flow.
- ESP32-S3 runtime now shares the same USB MIDI SysEx connection path, but Android does not yet ship the ESP-native flashing flow, so update UI must not route ESP boards into STM32 DFU.

---

## 7) Documentation maintenance rule

When changing Android transport, connection lifecycle, or firmware update UX behavior, update this README in the same PR.
