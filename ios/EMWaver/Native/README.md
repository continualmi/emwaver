# Rust Buffer Core (iOS)

This directory is reserved for iOS-native artifacts; the Rust buffer core is built and linked automatically by Xcode.

## How it links

The `EMWaver` Xcode target runs a `Build Rust Buffer Core` script phase which:
- (Removed) Rust buffer-core build step; iOS buffer logic is implemented in Swift
- writes `$(TARGET_TEMP_DIR)/libemwaver_buffer_ios.a`
- links it via `OTHER_LDFLAGS`

If Rust isn't installed (or the iOS targets aren't available), Xcode will fail with a clear error during that script phase.

(Removed) Rust buffer-core build script; buffer logic is now pure Swift.

## Prereqs

- Install Rust via `rustup` (Xcode’s build phase uses `~/.cargo/bin` to avoid Homebrew/toolchain mismatch issues).
- The build phase auto-installs required iOS targets (`aarch64-apple-ios`, `aarch64-apple-ios-sim`, `x86_64-apple-ios`) on first build.

## Optional: build an XCFramework manually

If you ever want a standalone XCFramework (e.g. for distribution), run:

```bash
# (Rust buffer-core crate removed)
chmod +x build-xcframework.sh
./build-xcframework.sh
```
