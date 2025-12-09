#!/bin/bash
# Script to update version numbers across all EMWaver components
# Usage: ./scripts/update-version.sh <VERSION>
# Example: ./scripts/update-version.sh 1.2.3

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <VERSION>"
    echo "Example: $0 1.2.3"
    exit 1
fi

VERSION="$1"

# Validate version format (MAJOR.MINOR.PATCH)
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: Version must be in format MAJOR.MINOR.PATCH (e.g., 1.2.3)"
    exit 1
fi

# Calculate version code (MAJOR * 10000 + MINOR * 100 + PATCH)
IFS='.' read -r MAJOR MINOR PATCH <<< "$VERSION"
VERSION_CODE=$((MAJOR * 10000 + MINOR * 100 + PATCH))

echo "Updating version to $VERSION (versionCode: $VERSION_CODE)"
echo ""

# Update Android version
echo "Updating Android..."
ANDROID_GRADLE="android/app/build.gradle"
if [ -f "$ANDROID_GRADLE" ]; then
    # Update versionName
    sed -i.bak "s/versionName \".*\"/versionName \"$VERSION\"/" "$ANDROID_GRADLE"
    # Update versionCode
    sed -i.bak "s/versionCode [0-9]*/versionCode $VERSION_CODE/" "$ANDROID_GRADLE"
    rm -f "${ANDROID_GRADLE}.bak"
    echo "  ✓ Updated $ANDROID_GRADLE"
else
    echo "  ✗ $ANDROID_GRADLE not found"
fi

# Update iOS version
echo "Updating iOS..."
IOS_PROJECT="ios/EMWaver.xcodeproj/project.pbxproj"
if [ -f "$IOS_PROJECT" ]; then
    # Update MARKETING_VERSION
    sed -i.bak "s/MARKETING_VERSION = [^;]*/MARKETING_VERSION = $VERSION/" "$IOS_PROJECT"
    # Update CURRENT_PROJECT_VERSION
    sed -i.bak "s/CURRENT_PROJECT_VERSION = [^;]*/CURRENT_PROJECT_VERSION = $VERSION_CODE/" "$IOS_PROJECT"
    rm -f "${IOS_PROJECT}.bak"
    echo "  ✓ Updated $IOS_PROJECT"
else
    echo "  ✗ $IOS_PROJECT not found"
fi

# Update CLI version
echo "Updating CLI..."
CLI_TOML="cli/Cargo.toml"
if [ -f "$CLI_TOML" ]; then
    sed -i.bak "s/^version = \".*\"/version = \"$VERSION\"/" "$CLI_TOML"
    rm -f "${CLI_TOML}.bak"
    echo "  ✓ Updated $CLI_TOML"
else
    echo "  ✗ $CLI_TOML not found"
fi

# Update Desktop App versions
echo "Updating Desktop App..."
TAURI_CONF="app/src-tauri/tauri.conf.json"
if [ -f "$TAURI_CONF" ]; then
    # Use a more robust sed pattern for JSON
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS sed
        sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$TAURI_CONF"
    else
        # Linux sed
        sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$TAURI_CONF"
    fi
    rm -f "${TAURI_CONF}.bak"
    echo "  ✓ Updated $TAURI_CONF"
else
    echo "  ✗ $TAURI_CONF not found"
fi

APP_PACKAGE_JSON="app/package.json"
if [ -f "$APP_PACKAGE_JSON" ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$APP_PACKAGE_JSON"
    else
        sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$APP_PACKAGE_JSON"
    fi
    rm -f "${APP_PACKAGE_JSON}.bak"
    echo "  ✓ Updated $APP_PACKAGE_JSON"
else
    echo "  ✗ $APP_PACKAGE_JSON not found"
fi

# Update Firmware version
echo "Updating Firmware..."
FIRMWARE_INIT="main/init.c"
if [ -f "$FIRMWARE_INIT" ]; then
    sed -i.bak "s/#define FIRMWARE_VERSION \"[^\"]*\"/#define FIRMWARE_VERSION \"$VERSION\"/" "$FIRMWARE_INIT"
    rm -f "${FIRMWARE_INIT}.bak"
    echo "  ✓ Updated $FIRMWARE_INIT"
else
    echo "  ✗ $FIRMWARE_INIT not found"
fi

echo ""
echo "Version update complete!"
echo ""
echo "Summary:"
echo "  Version: $VERSION"
echo "  Version Code: $VERSION_CODE"
echo ""
echo "Next steps:"
echo "  1. Review the changes: git diff"
echo "  2. Commit: git commit -am \"chore: bump version to $VERSION\""
echo "  3. Tag: git tag -a v$VERSION -m \"Release v$VERSION\""
echo "  4. Push: git push origin main && git push origin v$VERSION"
echo "  5. Create GitHub release with artifacts"
