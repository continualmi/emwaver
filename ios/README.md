# iOS App (`/ios`)

Native iOS EMWaver application (Swift/SwiftUI + Xcode project).

This app provides mobile UX for EMWaver device control, local scripts, optional Agent assistance, and firmware asset integration.

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

## 2.1 Auth

`ios/EMWaver/Auth/`:
- `AuthenticationManager.swift`
- `KeychainStore.swift`
- `SignInSheet.swift`

Responsibilities:
- local Agent API-key persistence for optional Agent replies.

Current guidance:
- there is no EMWaver account, Google/Firebase sign-in, or hosted session restore path,
- the visible key sheet stores a user-provided Agent API key locally in Keychain,
- local scripts and hardware control must not depend on this key.

## 2.2 Device and transport managers

`ios/EMWaver/Managers/`:
- `USBManager.swift`
- `USBManager+ScriptDevice.swift`
- `UsbMidiSysex.swift`
- `HostSessionManager.swift` (local script-status state only).

Responsibilities:
- USB device communication,
- sampler-compatible script transport behavior for built-in scripts like `sampler.emw`, including continuous all-zero stream-lane capture during active sampling.

## 2.3 Views

`ios/EMWaver/Views/`:
- scripts container.

## 3) Bundled firmware assets

- `ios/EMWaver/firmware/emwaver.bin`
- `ios/EMWaver/ota/emwaveresp.bin`

These are repo-managed payloads synced by firmware update tooling and consumed by update flows.

---

## 4) Native interop note

- `ios/EMWaver/Managers/NativeBufferRust.swift`
- `ios/EMWaver/Native/README.md`

Interop/legacy native-buffer components exist; keep usage aligned with current product direction and avoid introducing new hard dependencies without explicit decision.

---

## 5) Build and run

Open `ios/EMWaver.xcodeproj` in Xcode and run the `EMWaver` scheme on simulator/device.

The iOS Agent key sheet stores a user-provided Agent API key locally in Keychain. Agent calls require `EMWAVER_AGENT_ENDPOINT`, `CONTINUAL_AGENT_ENDPOINT`, or `AgentEndpointURL` in `Info.plist`; local device/script use does not. The endpoint should be the MGPT responses endpoint. The shared Apple Agent client creates a persistent MGPT universe from stored prompt `emwaver-prompt` and then sends only `universe` + `userInput`.

Do not assume CI/agent environment can run full iOS builds; validate on proper macOS/Xcode setup.

## 6) App Store automation

The iOS release path uses Fastlane from this folder so App Store uploads can run from a local Mac or be reused later from Xcode Cloud.

One-time setup on the release Mac:

1. Create an App Store Connect API key with access to the EMWaver app.
2. Store the private `.p8` key outside the repository.
3. Export these environment variables:

```sh
export APP_STORE_CONNECT_API_KEY_ID="..."
export APP_STORE_CONNECT_API_ISSUER_ID="..."
export APP_STORE_CONNECT_API_KEY_PATH="$HOME/secure/AuthKey_....p8"
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
scripts/ios-release.sh beta
scripts/ios-release.sh release
```

Lanes:
- `test` runs the `EMWaver` scheme tests on the default simulator.
- `archive` creates `build/ios/EMWaver.ipa` without uploading.
- `beta` builds and uploads the IPA to TestFlight.
- `release` uploads metadata and the latest local IPA when present, but does not submit for App Review.

Apple review remains a manual App Store Connect checkpoint: select the processed build, confirm compliance/review answers, and click the review submission button.

Fastlane metadata lives in `ios/fastlane/metadata/en-US/`. Screenshots can be added under `ios/fastlane/screenshots/en-US/` and will be uploaded by the `release` lane.

## 6.1 GitHub Actions TestFlight release

`.github/workflows/ios-testflight-release.yml` can build a signed IPA on a GitHub macOS runner and upload it to TestFlight. Configure a protected GitHub Environment named `app-store` and store these environment secrets there:

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

The workflow runs manually from GitHub Actions or when pushing tags matching `ios-v*` or `emwaver-ios-v*`. Keep the `app-store` environment protected with required reviewers so Apple signing secrets are only exposed after explicit approval.

---

## 7) Contributor guardrails

1. Keep iOS-specific UI/state logic in `/ios`, move reusable logic to `/apple` package.
2. Keep transport behavior compatible with firmware protocol contracts.
3. Keep auth/token handling and secure storage paths explicit and reviewed.
4. Update tests when changing managers used by device/transport.

---

## 8) Documentation maintenance rule

When changing manager responsibilities, auth flows, or firmware asset paths, update this README in same PR.
