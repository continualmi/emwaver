# EMWaver Release Guide

This document explains how to create GitHub releases and manage versions across all EMWaver components.

## Current Version Locations

- **Android**: `android/app/build.gradle` - `versionCode` and `versionName`
- **iOS**: `ios/EMWaver.xcodeproj/project.pbxproj` - `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION`
- **CLI**: `cli/Cargo.toml` - `version`
- **Desktop App**: `app/src-tauri/tauri.conf.json` and `app/package.json` - `version`
- **Firmware**: `main/init.c` - `FIRMWARE_VERSION` macro

## Version Strategy

### Recommended Approach: Unified Versioning

Use semantic versioning (MAJOR.MINOR.PATCH) across all components:
- **MAJOR**: Breaking changes (API changes, major feature removals)
- **MINOR**: New features, backward-compatible additions
- **PATCH**: Bug fixes, minor improvements

**Example**: `v1.2.3` means:
- Major version: 1
- Minor version: 2
- Patch version: 3

### Version Synchronization Options

#### Option 1: Unified Version (Recommended)
All components share the same version number (e.g., `1.2.3`). This simplifies release management and makes it clear which versions work together.

**Pros**: Simple, clear, easy to communicate
**Cons**: Components may not all change in every release

#### Option 2: Independent Versions
Each component has its own version (e.g., Firmware `1.2.0`, Android `1.1.5`, CLI `0.3.2`).

**Pros**: More flexible, reflects actual changes per component
**Cons**: More complex, harder to track compatibility

**Recommendation**: Start with Option 1 (unified versioning) for simplicity. You can always move to independent versions later if needed.

## Creating GitHub Releases

### Manual Release Process

1. **Update all version numbers** across components (see scripts below)
2. **Build release artifacts**:
   - Android: `./gradlew assembleRelease` → `android/app/build/outputs/apk/release/app-release.apk`
   - CLI: `cargo build --release` → `cli/target/release/emwaver-cli` (or `.exe` on Windows)
   - Desktop: `cd app && npm run tauri build` → `app/src-tauri/target/release/` (platform-specific)
   - Firmware: `idf.py build` → `build/emwaver.bin` (or `.elf`)
3. **Create a Git tag**: `git tag -a v1.2.3 -m "Release v1.2.3"`
4. **Push the tag**: `git push origin v1.2.3`
5. **Create GitHub Release**:
   - Go to GitHub → Releases → "Draft a new release"
   - Select the tag you just created
   - Title: `v1.2.3` or `EMWaver v1.2.3`
   - Description: List changes, fixes, new features
   - Upload artifacts:
     - `emwaver-android-v1.2.3.apk`
     - `emwaver-cli-v1.2.3-{platform}.{ext}` (e.g., `-macos`, `-linux`, `-windows.exe`)
     - `emwaver-desktop-v1.2.3-{platform}.{ext}` (e.g., `.dmg`, `.AppImage`, `.exe`)
     - `emwaver-firmware-v1.2.3.bin`
   - Mark as "Latest release" if this is the newest
   - Publish

### Automated Release Script

Create a script to automate version updates and artifact building (see `scripts/release.sh` below).

## Play Store & App Store Integration

### Android Play Store

The Play Store uses two version identifiers:
- **versionCode** (integer): Must increment with each release (e.g., 1, 2, 3...)
- **versionName** (string): User-facing version (e.g., "1.2.3")

**Syncing Strategy**:
1. Use semantic versioning for `versionName` (e.g., "1.2.3")
2. Calculate `versionCode` from version: `MAJOR * 10000 + MINOR * 100 + PATCH`
   - Example: `1.2.3` → `versionCode = 1*10000 + 2*100 + 3 = 10203`
   - This allows up to 99 minor and 99 patch versions per major version
3. When uploading to Play Store, ensure `versionCode` matches your calculated value
4. Play Store will automatically reject uploads if `versionCode` doesn't increase

**Example**:
```gradle
versionName "1.2.3"
versionCode 10203  // 1*10000 + 2*100 + 3
```

### iOS App Store

The App Store uses:
- **CFBundleShortVersionString** (`MARKETING_VERSION`): User-facing version (e.g., "1.2.3")
- **CFBundleVersion** (`CURRENT_PROJECT_VERSION`): Build number (integer, must increment)

**Syncing Strategy**:
1. Use semantic versioning for `MARKETING_VERSION` (e.g., "1.2.3")
2. Use the same calculation for `CURRENT_PROJECT_VERSION`: `MAJOR * 10000 + MINOR * 100 + PATCH`
   - Example: `1.2.3` → `CURRENT_PROJECT_VERSION = 10203`
3. When uploading to App Store Connect, ensure build number matches
4. App Store requires build number to increase with each upload

**Example** (in Xcode project):
```
MARKETING_VERSION = 1.2.3
CURRENT_PROJECT_VERSION = 10203
```

## Release Checklist

- [ ] Update version numbers in all components
- [ ] Update CHANGELOG.md (if you maintain one)
- [ ] Build all release artifacts
- [ ] Test release builds on target platforms
- [ ] Create Git tag
- [ ] Push tag to GitHub
- [ ] Create GitHub Release with artifacts
- [ ] Upload to Play Store (Android)
- [ ] Upload to App Store Connect (iOS)
- [ ] Update documentation if needed

## Version Update Scripts

### Quick Version Update (Manual)

**Android** (`android/app/build.gradle`):
```gradle
versionCode 10203  // Calculate from version
versionName "1.2.3"
```

**iOS** (`ios/EMWaver.xcodeproj/project.pbxproj`):
```
MARKETING_VERSION = 1.2.3;
CURRENT_PROJECT_VERSION = 10203;
```

**CLI** (`cli/Cargo.toml`):
```toml
version = "1.2.3"
```

**Desktop App** (`app/src-tauri/tauri.conf.json` and `app/package.json`):
```json
"version": "1.2.3"
```

**Firmware** (`main/init.c`):
```c
#define FIRMWARE_VERSION "1.2.3"
```

### Automated Version Script

See `scripts/update-version.sh` for an automated script that updates all version numbers from a single source.

## Release Notes Template

```markdown
## EMWaver v1.2.3

### What's New
- Feature 1
- Feature 2

### Improvements
- Improvement 1
- Improvement 2

### Bug Fixes
- Fixed issue X
- Fixed issue Y

### Downloads
- **Android**: [emwaver-android-v1.2.3.apk](link)
- **iOS**: Available on App Store
- **Desktop**: [macOS](link) | [Windows](link) | [Linux](link)
- **CLI**: [macOS](link) | [Linux](link) | [Windows](link)
- **Firmware**: [emwaver-firmware-v1.2.3.bin](link)

### Installation
- Android: Download APK and enable "Install from unknown sources"
- Desktop: Extract and run the application
- CLI: Extract and add to PATH
- Firmware: Flash using `idf.py flash` or ESP-IDF tools
```

## Multiple Releases Per Version

Yes, you can create multiple GitHub releases with different artifacts under the same version tag, but it's better to:

1. **Use different tags** for different component releases (e.g., `v1.2.3-android`, `v1.2.3-cli`)
2. **Or use a single tag** (`v1.2.3`) and attach all artifacts to one release

**Recommendation**: Use a single release per version with all artifacts attached. This makes it easier for users to find everything they need for a specific version.

## Version Compatibility Matrix

Consider maintaining a compatibility matrix in your docs:

| Firmware | Android | iOS | Desktop | CLI |
|----------|---------|-----|---------|-----|
| 1.2.3    | 1.2.3+  | 1.2.3+ | 1.2.3+ | 1.2.3+ |
| 1.2.0    | 1.2.0+  | 1.2.0+ | 1.2.0+ | 1.2.0+ |

This helps users understand which versions work together.
