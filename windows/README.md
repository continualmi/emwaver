# Windows App (Windows 11)

This directory contains the native Windows application (WinUI 3, Windows App SDK).

Goals

- Windows-only (Windows 11).
- Native UI (WinUI 3) with excellent performance.
- Reuse shared Rust logic (`crates/emwaver-buffer-core`) via a small Windows FFI DLL.

Prereqs (Windows dev machine)

- Windows 11
- Visual Studio 2022
  - Workload: "Desktop development with C++" (for Windows SDK bits)
  - Workload: ".NET desktop development"
  - Component: Windows App SDK / WinUI 3 support
- .NET SDK 8.x
- Rust (MSVC toolchain)
  - Install via rustup and ensure the MSVC target is available.

Build/run (Windows)

1) Build the Rust DLL (to be added): `crates/emwaver-buffer-windows-ffi`
2) Copy the DLL next to the app binary (dev path), then run from Visual Studio.

Notes

- We intentionally keep transport native on Windows (USB MIDI SysEx I/O via Windows APIs).
- The Rust DLL is pure logic (buffering/status/sampler compression/tx pacing policy).
