# Rust Buffer Core (iOS)

This directory is where the generated `EmwaverBufferCore.xcframework` should live (not committed).

## Build the XCFramework

From the repo root:

```bash
cd cli/crates/emwaver-buffer-ios-ffi
chmod +x build-xcframework.sh
./build-xcframework.sh
```

This writes `ios/EMWaver/Native/EmwaverBufferCore.xcframework`.

## Enable in Xcode

Add `ios/EMWaver/Native/EmwaverBufferCore.xcframework` to `EMWaver.xcodeproj` and link it in the app target.

`ios/EMWaver/Managers/BLEManager.swift` uses the Rust core unconditionally via `ios/EMWaver/Managers/NativeBufferRust.swift`, so the app will fail to link if the XCFramework is missing.
