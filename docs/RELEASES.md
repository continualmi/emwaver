# EMWaver Release Workflows

This document tracks the current public preview release assets for the open-source EMWaver repo.

## Global version

EMWaver uses one product version across the native platforms. The current shared version is stored in the repository root `VERSION` file and is currently `1.0.2`.

Use `emwaver-v1.0.2` for the aligned public release tag. Platform-specific build counters still remain separate, such as iOS build numbers and Android `versionCode`.

Pushing an `emwaver-v*` tag builds the GitHub Release assets for Android direct APK, macOS DMG, Windows installer/ZIP, and Linux packages. Store uploads remain separate workflows because App Store Connect and Google Play have their own review/track state.

## New version flow

1. Choose the next SemVer product version, for example `1.0.3`.
2. Update the root `VERSION` file and the platform-owned version fields that are not generated from it:
   - iOS `MARKETING_VERSION`
   - macOS `MARKETING_VERSION`
   - Linux app crate version when the packaged app version should change
   - Windows assembly/file/app manifest versions
   - Android normally reads root `VERSION` as `versionName`, while `versionCode` remains a separate monotonically increasing Play/App install counter.
3. Commit and push the version bump to `main`.
4. Create and push the matching release tag:

```bash
git tag emwaver-v1.0.3
git push origin emwaver-v1.0.3
```

5. Watch the tag-triggered GitHub Actions release workflows and confirm the GitHub Release has the expected assets.
6. Run the store workflows separately for iOS App Store/TestFlight and Google Play, using the same product version and new platform build numbers/codes as required by each store.

## Public download links

The install page points desktop/direct-download buttons at GitHub Release assets under:

```text
https://github.com/continualmi/emwaver/releases/latest/download/
```

Keep the intended public release marked as GitHub's **Latest** release so these links continue to work across new versions.

Expected public assets:

- `EMWaver-android.apk` — signed Android direct-install APK
- `EMWaver-macos.dmg` — macOS preview DMG
- `EMWaverSetup-windows-x64.exe` — Windows installer
- `EMWaver-windows-x64.zip` — Windows portable package
- `EMWaver-linux-amd64.deb` — Linux Debian/Ubuntu preview package, published only when Linux packaging is ready for preview
- `EMWaver-linux-x64.tar.gz` — Linux generic tarball, published only when Linux packaging is ready for preview

Linux remains omitted from the public install buttons until the native GTK4/libadwaita app is ready for users.

## Workflows to run before opening the repo

For an aligned public release, push the matching `emwaver-vX.Y.Z` tag. The tag-triggered workflows publish assets to that release automatically.

Then verify assets and Latest status:

```bash
gh release view emwaver-v1.0.2 --json assets,url,isPrerelease,isDraft
gh release list --limit 5
```

For a rolling preview refresh only, run these manually from the GitHub Actions UI or with `gh workflow run ...`:

```bash
gh workflow run android-apk-release.yml -f tag=emwaver-preview
gh workflow run macos-dmg-release.yml -f tag=emwaver-preview
gh workflow run windows-exe-release.yml -f tag=emwaver-preview
gh workflow run linux-release.yml -f tag=emwaver-preview
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

## Linux

`.github/workflows/linux-release.yml` builds the native Rust + GTK4/libadwaita app on Ubuntu, runs Linux support-crate tests, and publishes:

- `EMWaver-linux-amd64.deb`
- `EMWaver-linux-x64.tar.gz`

The packages install the app binary, desktop entry, AppStream metadata, hicolor icon, default scripts, STM32 firmware payload, ESP helper source when available, and udev rules. ESP32 firmware images are included only when the ESP build outputs are present.

Linux release packages are preview artifacts for now; keep Linux off public install buttons until app-level validation is complete.

## Windows

`.github/workflows/windows-exe-release.yml` publishes both the installer and portable package. Code signing is optional and is enabled when these secrets are present:

- `WINDOWS_CODE_SIGNING_CERT_BASE64`
- `WINDOWS_CODE_SIGNING_CERT_PASSWORD`
- `WINDOWS_SIGNING_TIMESTAMP_URL` (optional; defaults to DigiCert timestamping)
