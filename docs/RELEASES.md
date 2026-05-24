# EMWaver Release Workflows

This document tracks the current public preview release assets for the open-source EMWaver repo.

## Preview release tag

The install page points desktop/direct-download buttons at GitHub Release assets under:

```text
https://github.com/continualmi/emwaver/releases/download/emwaver-preview/
```

Expected preview assets:

- `EMWaver-android.apk` — signed Android direct-install APK
- `EMWaver-macos.dmg` — macOS preview DMG
- `EMWaverSetup-windows-x64.exe` — Windows installer
- `EMWaver-windows-x64.zip` — Windows portable package

Linux is intentionally omitted from the public install buttons until the native GTK4/libadwaita app is ready.

## Workflows to run before opening the repo

Run these from the GitHub Actions UI or with `gh workflow run ...`:

```bash
gh workflow run android-apk-release.yml -f tag=emwaver-preview
gh workflow run macos-dmg-release.yml -f tag=emwaver-preview
gh workflow run windows-exe-release.yml -f tag=emwaver-preview
```

Then verify assets:

```bash
gh release view emwaver-preview --json assets,url
```

## Android APK signing

The public direct APK workflow requires the same upload keystore secrets used by the Play workflow:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

The workflow builds `app-release.apk`, verifies it with `apksigner`, and publishes it as `EMWaver-android.apk`. It should not publish `app-release-unsigned.apk`.

## Android Play

Use `.github/workflows/android-play-release.yml` for Google Play internal/closed/production tracks. That workflow also needs:

- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`

## iOS

Use `.github/workflows/ios-testflight-release.yml` for TestFlight and `.github/workflows/ios-app-store-upload.yml` for App Store candidates. There is no public unsigned IPA distribution path.

## macOS

`.github/workflows/macos-dmg-release.yml` builds and publishes `EMWaver-macos.dmg`. Treat this as the preview desktop artifact unless/until Developer ID signing and notarization are added.

## Windows

`.github/workflows/windows-exe-release.yml` publishes both the installer and portable package. Code signing is optional and is enabled when these secrets are present:

- `WINDOWS_CODE_SIGNING_CERT_BASE64`
- `WINDOWS_CODE_SIGNING_CERT_PASSWORD`
- `WINDOWS_SIGNING_TIMESTAMP_URL` (optional; defaults to DigiCert timestamping)
