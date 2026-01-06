# EMWaver Repository Guidelines

## Current Product Direction

EMWaver is now focused on shipping a **single, solid platform**:

- **Transport:** USB only (class-compliant **USB MIDI SysEx**, fixed 64‑byte frames)
- **Hardware:** **STM32 only** (one current-gen board)
- **Firmware:** **one** firmware binary for the platform (no board catalog, no variants)
- **Distribution:** **binary-first** (apps + firmware are shipped as binaries; end users should not be building or flashing from source)
- **Core UX:** **Wavelet-centered** hardware exploration (script + UI together, fast iteration, no reflashing)
- **Surface area shipped:** Android app, iOS app, Desktop app, CLI, VS Code extension

> Engineering note: this repo is still the engineering mono-repo, but the *product* is intentionally not “clone repo → toolchain setup → build/flash”.

---

## Platform Thesis

### The Core Thesis

EMWaver is about **hardware exploration**: education, tinkering, rapid “vibe hacking”.

We are **not** trying to be a general-purpose firmware development environment or a deployment platform.

**Guiding metric:**

> **Time to Full Chip Exploit** should be as low as possible.

Wavelets (EMWaver scripts) are the essence of EMWaver:

- No compile
- Ultra-fast hardware exploration
- In a single script you develop both:
  - low-level hardware interactions
  - high-level user interfaces

We treat `.emw` as a first-class format for these scripts.

### Explicit Tradeoffs

We intentionally give up:

- Wireless / BLE-first workflows.
- End-user firmware build/flash/customization workflows.

The board should be useful **only with the client** (Android/iOS/Desktop). That’s the point: the client is the product.

### What We Gain

A very simple platform:

- One board
- One firmware
- Apps on Android / iOS / Desktop

No build/flash loops, and no user-facing wrappers on top of MCU toolchains as a required workflow.

---

## Repository Overview

- **STM32 Firmware:** `stm/emwaver-firmware/` (single firmware)
- **Android:** `android/`
- **iOS:** `ios/`
- **Desktop App:** `app/` (Tauri)
- **CLI:** `cli/` (device shell + internal tooling)
- **VS Code Extension:** `vsc/` (Wavelet authoring + device shell integration)
- **Docs:** `docs/` (MkDocs)

## Project Structure & Module Organization

STM32 firmware lives in `stm/` (CubeMX/CubeIDE project). Treat CubeMX-generated output as generated code; keep handwritten logic in intended user-edit regions and prefer regeneration over manual edits to generated layers.

Apps live under `android/`, `ios/`, and `app/`. The Rust CLI lives under `cli/`.

## Transport / Buffer Model

EMWaver uses **fixed 64-byte framing** over a USB MIDI SysEx tunnel, with an append-only RX capture and cursor parsing model described in `docs/content/documentation/buffer.md`.

Keep on-wire semantics stable:

- `PACKET_SIZE = 64`
- ASCII command protocol inside the 64B frames
- status/flow-control frames (e.g. `BS` for retransmit pacing)

## Wavelets

Wavelets are user-authored extension bundles (manifest + JavaScript) that plug into the Wavelet Engine sandbox.

- **Parity-first UI DSL**: wavelet UI must render consistently across Android/iOS/Desktop.
- **Unified scripting engine**: WaveletEngine is the single runtime.
- **In-wavelet logging**: scripts surface output through wavelet UI components.

## Cross-Cutting Practices

- Keep changes scoped and avoid bundling unrelated work.
- Never commit secrets.
- Prefer ecosystem tooling (Gradle/Xcode/Cargo) for *developer builds*, but do not turn developer build/flash into a product requirement.

## Project Playbooks

### STM32 Firmware (`/stm`)

- **Single firmware**: `stm/emwaver-firmware/` is the only supported device firmware.
- **USB MIDI only**: the transport is class-compliant USB MIDI with the EMWaver SysEx tunnel.
- **End users**: do not document “build from source” as a required workflow.
- **Internal/dev**: DFU may still be used for development/manufacturing, but keep that out of the core product narrative.

#### CubeMX (Optional)

The repo is set up to be **self-contained for firmware builds** (no STM32CubeMX required) by vendoring:
- `stm/emwaver-firmware/Drivers/` (HAL/CMSIS)
- `stm/emwaver-firmware/Middlewares/` (USB Device library)
- `stm/emwaver-firmware/USB_DEVICE/Target/usbd_conf.c/.h` (tracked; not generated on-demand)

Use CubeMX only when you intentionally need to change clocks/pins/peripheral config and regenerate scaffolding.

**Important caveat:** the STM32F0 CubeMX firmware packs don’t expose a “USB MIDI” device class in the UI. Regeneration will typically target classes like CDC/HID and can overwrite USB scaffolding. If you regenerate:
- Expect `USB_DEVICE/*` and `Core/Src/main.c` generated sections to churn.
- You may need to re-apply EMWaver-specific USB MIDI pieces (`USB_DEVICE/App/usbd_midi.*`, registration in `USB_DEVICE/App/usb_device.c`, and MIDI-oriented config in `USB_DEVICE/Target/usbd_conf.*`).
- Keep handwritten logic inside `/* USER CODE BEGIN/END */` blocks; CubeMX will rewrite outside those regions.

### Android (`/android`)

- Native Android app.
- USB transport + Wavelet workflows must stay aligned with iOS and Desktop.

> **Agent Note:** Don’t run Gradle builds unless explicitly requested.

### iOS (`/ios`)

- SwiftUI app using **USB MIDI (CoreMIDI)** transport.
- Treat iOS as first-class: iPhone USB‑C works directly; Lightning works via Apple’s USB host adapter.

> **Agent Note:** Don’t run `xcodebuild`; leave builds to Xcode.

### Desktop App (`/app`)

- Cross-platform Tauri app.
- Uses the **`emwaver` daemon** (implemented in `cli/`) for device I/O: the app speaks JSON-RPC over a Unix socket (see `app/src-tauri/src/daemon_client.rs`), and the daemon owns the USB MIDI connection + command execution.
- Focus is Wavelets authoring + device interaction.
- Avoid expanding/centering an IDE-style firmware build/flash workflow.

### CLI (`/cli`)

- Rust crate/binary (`emw` → `emwaver`) that hosts the **canonical shared Rust core**.
- Shared core lives in `cli/crates/emwaver-buffer-core` (64B framing, append-only RX capture, cursor parsing, `BS` status parsing, sampler viewport compression).
- Mobile bindings are built from that core:
  - iOS: `cli/crates/emwaver-buffer-ios-ffi`
  - Android: `cli/crates/emwaver-buffer-android-jni`
- Also includes the long-lived **daemon** (`cli/src/daemon.rs`) used by Desktop to keep a single stable device connection.
- Keep UX aligned with the 64B command protocol and on-wire framing.

### VS Code Extension (`/vsc`)

- VS Code integration for Wavelet authoring and device interaction.
- Do not position the extension as a required build/flash tool.

### Docs (`/docs`)

- MkDocs-based docs.
- Keep docs aligned with: STM32-only, USB MIDI-only, Wavelet-first.

## Agent Workflow Guardrails

- Do **not** `git commit` or `git push` unless explicitly requested.
