# Android App (`/android`)

Native Android EMWaver application (Gradle project, Java/Kotlin-style Android app structure).

This app provides mobile EMWaver device workflows: USB/BLE communication, local scripting surfaces, settings, and firmware asset packaging.

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
- `UsbMidiSysex.java` — shared SysEx/superframe transport codec.
- `USBService.java` / `USBManager-like services` — USB MIDI and ESP32 BLE device connection plumbing.
- `ui/emwaver/EspSerialFirmwareUpdater.java` — local Android ESP serial bootloader firmware updater for bundled ESP32, ESP32-S2, and ESP32-S3 image sets.
- `DeviceConnectionManager.java` / `DeviceConnectionService.java` — connection lifecycle.
- `CommandSender.java` — command dispatch path.
- `NativeBuffer.java` — native/buffer integration surface.
- `scripts/ScriptEngine.java` + `scripts/ScriptRenderView.java` — Rhino bridge + native script UI rendering. Android now bundles the shared `.js` script assets, loads `emw-kernel.js`, supports normal EMWaver imports through `require(...)`, and transpiles the same JSX subset used by the Apple runtime.
- `scripts/ScriptDeviceBridge.java` + `scripts/SimulatorScriptDeviceBridge.java` — pluggable real/simulated script device bridge for tests.
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
- local script dialogs,
- device update dialogs.

---

## 4) Bundled firmware assets

Firmware is sourced from the shared repo [`firmware/`](/Users/luisml/continualmi/emwaver/firmware) folder via the `syncBundledFirmware` Gradle task. This copies STM32 (`emwaver.bin`) plus every committed ESP family image set into generated Android assets:
- `emwaver-esp32-{bootloader,partition-table,ota-data,app}.bin`
- `emwaver-esp32s2-{bootloader,partition-table,ota-data,app}.bin`
- `emwaver-esp32s3-{bootloader,partition-table,ota-data,app}.bin`

---

## 5) Build/run (developer machine)

Typical flow:

```bash
cd android
./gradlew assembleDebug
```

or run from Android Studio.

Use the appropriate connected device/emulator setup. USB host and BLE behavior testing need real device support.

Release distribution:
- direct preview APKs are built and signed by `.github/workflows/android-apk-release.yml`.
- Google Play app bundles are built and uploaded by `.github/workflows/android-play-release.yml` through `android/fastlane/`.
- Direct APK and Play uploads require the protected `play-store` GitHub Environment secrets documented in `../docs/RELEASES.md`.

---

## 6) Guardrails

1. Keep transport compatibility aligned with firmware protocol (fixed-size packet model). USB MIDI remains preferred when a wired device is available; when no wired device is found, Android scans for the EMWaver BLE service and connects to ESP32 boards automatically. BLE and Wi-Fi carry the same SysEx/superframe envelope as USB MIDI so command opcodes and script behavior remain shared across transports.
2. Keep Android USB discovery aligned with STM32 and ESP32 EMWaver runtime descriptors, including target-aware ESP32-S2/ESP32-S3 product names; do not hard-code STM32-only or ESP32-S3-only identity assumptions in the runtime path.
3. Keep firmware asset paths stable unless coordinated across tooling and update flows.
4. Keep app-level dialogs/resources synced with underlying feature availability.
5. Avoid introducing platform-specific divergence where shared behavior can be aligned with iOS/macOS/web patterns.
6. **Transport session heartbeat is mandatory.** OS-level connection signals (BLE GATT callbacks, USB device removal broadcasts, Wi-Fi socket closures) are unreliable across Android versions, OEM skins, and board states. The only reliable way to confirm a device is still reachable is the application-level heartbeat: send opcode `0x0B`/`0x03` every 2 seconds over the active transport; if the firmware echo is not received within two heartbeat intervals, mark the connection as lost and clear `IsConnected`. Do not trust platform disconnection events as the sole liveness signal.

Simulator testing:
- `scripts/SimulatorScriptDeviceBridge.java` reads the shared `simulator/fixtures/*.json` contract and implements the same bridge used by `ScriptEngine`.
- Use it in Android runtime tests to run hardware-touching `.js` scripts without a physical USB device.

Current Android board split:
- STM32 runtime uses USB and can enter the DFU-based update flow.
- ESP32 runtime now shares the same USB connection path. ESP32-S3 can also connect over BLE; ESP32-S2 is USB/Wi-Fi only.
- Android can connect to a trusted LAN/VPN ESP32 Wi-Fi endpoint by manual host/IP and port using the firmware WebSocket path (`ws://<host>:3922/v1/ws`), discover `_emwaver._tcp` endpoints through Android NSD, and provision/clear/query ESP32 Wi-Fi setup over the active local USB/BLE/Wi-Fi connection.
- Android firmware update UI keeps ESP boards out of STM32 DFU. It uses the Android-native ESP serial bootloader updater and flashes the same four-image layout as macOS/Windows: bootloader, partition table, OTA data, and app. ESP firmware targets are auto-selected from connected board metadata or USB identity; Android no longer asks the user to pick an ESP family manually.
- The Android firmware update dialog follows the same user-visible state model as macOS and Windows: STM32 uses prompt/status/error/progress cards with footer actions, while ESP uses a bootloader card with Refresh, detected target, Flash firmware, progress, error, and done states.
- The Android device modal presents the active local device, transport, board family, firmware status, Wi-Fi actions, disconnect, and firmware update entry point in the same card-based style as the update dialog.

---

## 7) Documentation maintenance rule

When changing Android transport, connection lifecycle, or firmware update UX behavior, update this README in the same PR.

Android Agent-to-MCP direction:
- Remove the Android Agent chat interface/runtime and MGPT API-key plumbing.
- Android does not host an MCP server; it keeps local script import/app-local storage and local script execution.
- Do not require an EMWaver account, cloud sync, activated devices, hardware-UID registration, or device limits for local scripts/hardware.
- Hosted cloud files, hosted host-session UI, Firebase sign-in, hosted remote control, and cloud/local backend switching remain out of the Android app.
- Local USB/BLE/Wi-Fi device and script use must not depend on backend configuration.
