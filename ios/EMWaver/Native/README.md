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

1. Add `ios/EMWaver/Native/EmwaverBufferCore.xcframework` to `EMWaver.xcodeproj` and link it in the app target.
2. Add the Swift compile flag `EMWAVER_RUST_BUFFER_CORE`:
   - Target → Build Settings → Other Swift Flags → add `-DEMWAVER_RUST_BUFFER_CORE`

When enabled, `ios/EMWaver/Managers/BLEManager.swift` routes buffer/framing/status/compression logic through the Rust core via `ios/EMWaver/Managers/NativeBufferRust.swift`.

