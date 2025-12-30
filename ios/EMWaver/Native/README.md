# Rust Buffer Core (iOS)

This directory is reserved for iOS-native artifacts; the Rust buffer core is built and linked automatically by Xcode.

## How it links

The `EMWaver` Xcode target runs a `Build Rust Buffer Core` script phase which:
- builds `cli/crates/emwaver-buffer-ios-ffi` for the active platform/arch
- writes `$(TARGET_TEMP_DIR)/libemwaver_buffer_ios.a`
- links it via `OTHER_LDFLAGS`

If Rust isn't installed (or the iOS targets aren't available), Xcode will fail with a clear error during that script phase.

The script phase invokes `EMWaver/Native/build-rust-buffer-core.sh`.

## Prereqs

- Install Rust via `rustup` (Xcode’s build phase uses `~/.cargo/bin` to avoid Homebrew/toolchain mismatch issues).
- The build phase auto-installs required iOS targets (`aarch64-apple-ios`, `aarch64-apple-ios-sim`, `x86_64-apple-ios`) on first build.

## Optional: build an XCFramework manually

If you ever want a standalone XCFramework (e.g. for distribution), run:

```bash
cd cli/crates/emwaver-buffer-ios-ffi
chmod +x build-xcframework.sh
./build-xcframework.sh
```
