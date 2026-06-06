# iOS App (`/ios`)

Native iOS EMWaver application (Swift/SwiftUI + Xcode project).

This app provides mobile UX for EMWaver device control, local scripts, and firmware asset integration.

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

## 2.1 MCP boundary

The legacy Agent API-key persistence, sign-in sheet, and in-app Agent/MGPT reply
flows have been removed.

Current guidance:
- there is no EMWaver account, Google/Firebase sign-in, or hosted session restore path,
- mobile does not host an external MCP endpoint,
- local scripts and hardware control must not depend on model/API keys.

## 2.2 Device and transport managers

`ios/EMWaver/Managers/`:
- `USBManager.swift`
- `USBManager+ScriptDevice.swift`
- `UsbMidiSysex.swift`
- `DeviceBufferSession.swift`
- `TransportDeviceConnectionState.swift`
- `TransportDeviceSessionRegistry.swift`
- `HostSessionManager.swift` (local script-status state only).

Responsibilities:
- local device communication over USB MIDI, ESP32 BLE, and ESP32 Wi-Fi,
- transport session management: before script execution, iOS now claims the ESP32 firmware transport session with CONNECT (0x0B, 0x01), keeps it alive with a 2-second heartbeat (0x0B, 0x03) while the script runs, and releases it with DISCONNECT (0x0B, 0x02) when the script stops,
- sampler-compatible script transport behavior for built-in scripts like `sampler.emw`, including continuous all-zero stream-lane capture during active sampling.

### Single serial command bus

All command traffic (transport session CONNECT/DISCONNECT/HEARTBEAT and script opcodes like `gpio_read`/`spi_transfer`) flows through a single serial bus:

- **`commandSemaphore`** (`DispatchSemaphore(value: 1)`) wraps every `sendCommand` entry point. Only one command is in flight at any time — script commands, transport session commands, and heartbeat pings all serialize through the same lock.
- **Commands are synchronous.** Every `sendCommand` acquires the semaphore, dispatches the outgoing packet via the I/O queue, and polls the response buffer until a reply arrives or the timeout expires. The caller blocks until the command completes.
- **Stream lane is separate.** The sampler's `transmitBuffer` sends bulk data through the superframe stream lane asynchronously (fire-and-forget over `midiQueue`), consuming buffer-status packets for flow control. It never competes with command-lane traffic for the semaphore.
- **`midiQueue` is the I/O dispatch queue**, not the command serialization queue. It serializes all packet reads/writes for CoreMIDI, BLE, and Wi-Fi transports. The heartbeat timer fires on `midiQueue` but hands off the actual command cycle to `DispatchQueue.global(qos: .utility)` — matching the macOS pattern — so `midiQueue` stays free to process incoming responses while a command is polling.

The iOS transport keeps the historical `USBManager` API as the app-facing device facade. USB MIDI remains preferred when a wired CoreMIDI source/destination is available. When no wired device is found, the manager scans for the EMWaver BLE service and connects to ESP32 boards automatically. BLE carries the same EMWaver SysEx/superframe envelope as USB MIDI so command opcodes and script behavior remain shared across transports.

iOS also supports a manual ESP32 Wi-Fi runtime connection through the firmware WebSocket endpoint at `ws://<host>:3922/v1/ws`. The scripts toolbar exposes `Connect Wi-Fi` for trusted LAN/VPN endpoints and `Wi-Fi Setup` for sending, clearing, and checking ESP32 SSID/password provisioning over the active local transport. Wi-Fi uses the same SysEx/superframe payload path as USB MIDI and BLE; mDNS discovery remains planned separately.

## 2.3 Views

`ios/EMWaver/Views/`:
- `ScriptsContainerView.swift` — script UI shell, compact device/transport toolbar, Wi-Fi connect/setup sheets. Owns `IOSScriptSessionManager` which manages per-script sessions and wires transport session begin/end around script execution through the `IOSTargetedScriptDeviceBase` protocol. When no physical device is connected, the script UI previews against the shared basic simulator so UI rendering remains available on iOS without hardware attached.
- `FirmwareUpdateSheet.swift` exposes the local firmware surface from the iOS
  toolbar.

## 3) Bundled firmware assets

- Firmware is sourced from the shared repo [`firmware/`](/Users/luisml/continualmi/emwaver/firmware) folder via an Xcode folder reference. iOS currently exposes bundled payload visibility, local share/handoff for the bundled STM32 and ESP images, and STM32 Update Mode entry over the active local transport. STM32 DFU flashing is intentionally owned by macOS, Windows, and Android because iOS does not expose the USB DFU device class needed for the transfer runtime. ESP serial flashing also remains outside the iOS runtime; use macOS, Windows, or Android for the actual flash step.

---

## 4) Native interop note

- `ios/EMWaver/Managers/NativeBufferRust.swift`
- `ios/EMWaver/Native/README.md`

Interop/legacy native-buffer components exist; keep usage aligned with current product direction and avoid introducing new hard dependencies without explicit decision.

---

## 5) Build and run

Open `ios/EMWaver.xcodeproj` in Xcode and run the `EMWaver` scheme on simulator/device.

iOS keeps local script import/app-local storage and local device/script use without hosting an MCP endpoint.

Do not assume CI or automation environments can run full iOS builds; validate on proper macOS/Xcode setup.

## 6) App Store automation

The iOS release path uses Fastlane from this folder so App Store uploads can run from a local Mac or be reused later from Xcode Cloud.

One-time setup on the release Mac:

1. Create an App Store Connect API key with access to the EMWaver app.
2. Store the private `.p8` key outside the repository.
3. Export these environment variables:

```sh
export APP_STORE_CONNECT_API_KEY_ID="..."
export APP_STORE_CONNECT_API_ISSUER_ID="..."
export EMWAVER_APP_STORE_CONNECT_API_KEY_PATH="$HOME/secure/AuthKey_....p8"
```

Optional release variables:

```sh
export EMWAVER_IOS_BUILD_NUMBER="101"
export EMWAVER_IOS_CHANGELOG="Release notes for TestFlight."
export EMWAVER_APPLE_ID="apple-account@example.com"
export EMWAVER_ITC_TEAM_ID="170301490951"
```

Release commands from the repo root:

```sh
scripts/ios-release.sh test
scripts/ios-release.sh archive
scripts/ios-release.sh release_upload
scripts/ios-release.sh release
```

Lanes:
- `test` runs the `EMWaver` scheme tests on the default simulator.
- `archive` creates `build/ios/EMWaver.ipa` without uploading.
- `release_upload` builds and uploads the IPA to App Store Connect/TestFlight processing.
- `beta` and `app_store_upload` remain compatibility aliases for `release_upload`.
- `release` uploads metadata and the latest local IPA when present, but does not submit for App Review.

Apple review remains a manual App Store Connect checkpoint: select the processed build, confirm compliance/review answers, and click the review submission button.

Fastlane metadata lives in `ios/fastlane/metadata/en-US/`. Screenshots can be added under `ios/fastlane/screenshots/en-US/` and will be uploaded by the `release` lane.

## 6.1 GitHub Actions iOS release upload

`.github/workflows/ios-release-upload.yml` (`iOS Release Upload`) can build a signed IPA on a GitHub macOS runner and upload it to App Store Connect. After Apple processes it, the same build appears in TestFlight and can be selected for App Store review. Configure a protected GitHub Environment named `app-store` and store these environment secrets there:

```text
APP_STORE_CONNECT_API_KEY_ID
APP_STORE_CONNECT_API_ISSUER_ID
APP_STORE_CONNECT_API_KEY_BASE64
IOS_DISTRIBUTION_CERTIFICATE_BASE64
IOS_DISTRIBUTION_CERTIFICATE_PASSWORD
IOS_PROVISIONING_PROFILE_BASE64
IOS_PROVISIONING_PROFILE_NAME
IOS_KEYCHAIN_PASSWORD
```

Create the base64 values on macOS without line wrapping:

```sh
base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy
base64 -i distribution.p12 | pbcopy
base64 -i EMWaver_AppStore.mobileprovision | pbcopy
```

The workflow runs manually from GitHub Actions or when pushing tags matching `ios-v*` or `emwaver-ios-v*`. It validates that the IPA bundles the JavaScript `DefaultScripts/*.js` assets and contains no legacy `.emw` scripts before upload. Keep the `app-store` environment protected with required reviewers so Apple signing secrets are only exposed after explicit approval.

After the workflow completes and Apple finishes processing the build, finish the release in App Store Connect by testing in TestFlight or selecting the processed build, confirming review details, and submitting for review manually. `ios/EMWaver/Info.plist` sets `ITSAppUsesNonExemptEncryption` to `false`, so standard Apple export-compliance encryption prompts should be pre-answered for new builds.

---

## 7) Contributor guardrails

1. Keep iOS-specific UI/state logic in `/ios`, move reusable logic to `/apple` package.
2. Keep transport behavior compatible with firmware protocol contracts.
3. Keep auth/token handling and secure storage paths explicit and reviewed.
4. Update tests when changing managers used by device/transport.
5. Transport session begin/end must be called through `IOSScriptSessionManager.run()` / `IOSScriptSession.stop()`. Do not add transport session claims outside the script lifecycle.
6. All `sendCommand` callers share the same `commandSemaphore`; do not bypass the locked `sendCommand` entry points for operational commands during a session.

---

## 8) Documentation maintenance rule

When changing manager responsibilities, auth flows, or firmware asset paths, update this README in same PR.
