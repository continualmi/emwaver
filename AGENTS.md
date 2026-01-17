# EMWaver Repository Guidelines

## Current Product Direction

EMWaver is now focused on shipping a **single, solid platform**:

- **Transport:** USB only (class-compliant **USB MIDI SysEx**, fixed 64‑byte frames)
- **Hardware:** **STM32 only** (one current-gen board)
- **Firmware:** **one** firmware binary for the platform (no board catalog, no variants)
- **Distribution:** **binary-first** (apps + firmware are shipped as binaries; end users should not be building or flashing from source)
- **Core UX:** **Script-centered** hardware exploration (script + UI together, fast iteration, no reflashing)
- **Surface area shipped:** Android app, iOS app, Desktop app, CLI

> Engineering note: this repo is still the engineering mono-repo, but the *product* is intentionally not “clone repo → toolchain setup → build/flash”.

---

## Platform Thesis

### The Core Thesis

EMWaver is about **hardware exploration**: education, tinkering, rapid “vibe hacking”.

We are **not** trying to be a general-purpose firmware development environment or a deployment platform.

**Guiding metric:**

> **Time to Full Chip Exploit** should be as low as possible.

EMWaver scripts are the essence of EMWaver:

- No compile
- Ultra-fast hardware exploration
- In a single script you develop both:
  - low-level hardware interactions
  - high-level user interfaces

We treat `.js` as a first-class format for these scripts.

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
- **CLI:** `app/cli/` (device shell + internal tooling)
- **Docs:** `docs/` (MkDocs)

## Project Structure & Module Organization

STM32 firmware lives in `stm/` (CubeMX/CubeIDE project). Treat CubeMX-generated output as generated code; keep handwritten logic in intended user-edit regions and prefer regeneration over manual edits to generated layers.

Apps live under `android/`, `ios/`, and `app/`. The Rust CLI lives under `app/cli/`.

## Transport / Buffer Model

EMWaver uses **fixed 64-byte framing** over a USB MIDI SysEx tunnel, with an append-only RX capture and cursor parsing model described in `docs/content/documentation/buffer.md`.

Keep on-wire semantics stable:

- `PACKET_SIZE = 64`
- ASCII command protocol inside the 64B frames
- status/flow-control frames (e.g. `BS` for retransmit pacing)

## Scripts

Scripts are user-authored extension bundles (manifest + JavaScript) that plug into the Script Engine sandbox.

- **Parity-first UI DSL**: script UI must render consistently across Android/iOS/Desktop.
- **Unified scripting engine**: ScriptEngine is the single runtime.
- **In-script logging**: scripts surface output through script UI components.

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
- USB transport + Script workflows must stay aligned with iOS and Desktop.

> **Agent Note:** Don’t run Gradle builds unless explicitly requested.

### iOS (`/ios`)

- SwiftUI app using **USB MIDI (CoreMIDI)** transport.
- Treat iOS as first-class: iPhone USB‑C works directly; Lightning works via Apple’s USB host adapter.

> **Agent Note:** Don’t run `xcodebuild`; leave builds to Xcode.

### Desktop App (`/app`)

- Cross-platform Tauri app.
- Owns device I/O directly (in-process USB MIDI + framing) and runs scripts locally for lowest latency.
- Exposes a simple local Desktop↔CLI bridge (file-based mailbox) so the CLI can request actions without owning the USB connection.
- Focus is Scripts authoring + device interaction.
- Avoid expanding/centering an IDE-style firmware build/flash workflow.

### CLI (`/cli`)

- Rust crate/binary (`emw` → `emwaver`) that acts as a helper client for the Desktop app.
- Shared Rust core lives under `app/crates/`:
  - `app/crates/emwaver-buffer-core` (64B framing, append-only RX capture, cursor parsing, `BS` status parsing, sampler viewport compression)
  - `app/crates/emwaver-buffer-ios-ffi` (iOS)
  - `app/crates/emwaver-buffer-android-jni` (Android)
- The CLI does not own the USB MIDI connection; it asks the Desktop app to execute device commands and scripts.

#### Debugging With `emwaver cmd`

The `emwaver` CLI is a fast way to debug device ↔ firmware issues without the desktop UI.

- Connection sanity check: open Desktop app, connect device, then run `emwaver cmd version` (expects `Welcome to EMWaver firmware ...`).
- Raw SPI debug (CS is manual GPIO; `--cs` uses encoded pins: `PA0..PA15 => 0..15`, `PB0..PB15 => 16..31`):
  - CC1101 VERSION (returns 2 bytes: status + data): `emwaver cmd --verbose "spi xfer --cs=4 --tx=F100 --rx=2"` (look at `rx[1]`).
  - CC1101 helper path: `emwaver cmd --verbose "cc1101 read --reg=0x31"`.
- GPIO inspection can confirm pin mux/state while debugging: `emwaver cmd --verbose "gpio info --pin=4"`.
- The transport is fixed 64-byte frames: the command string must be ≤ 64 bytes or you’ll hit `Command too large`.
  - Prefer compact hex like `--tx=F100` over verbose `--tx=0xF1,0x00` when sending many bytes.

### Docs (`/docs`)

- MkDocs-based docs.
- Keep docs aligned with: STM32-only (current product), USB MIDI-only, Script-first.

#### Hardware docs: Builder vs History

Docs includes a hardware UX under `docs/content/hardware-catalog/`.

- **Builder / Designer** (`docs/content/hardware-catalog/hardware.html`): only for the **single current EMWaver board**.
  - Allowed: JLCPCB-ready downloads (Gerber/BOM/CPL/PCB PDF) and **Onshape casing links** per variant.
  - Variants are **population/placement options on the same PCB** (IR / ISM / GPIO / etc.).
  - Disallowed: schematics/electronics CAD exposure.
- **Board history / catalog** (`docs/content/hardware-catalog/catalog.html`, `docs/content/hardware-catalog/device.html`): archive only.
  - Allowed: description, photo gallery, and basic metadata (name, release date, MCU family like `stm32`/`esp32`, lifecycle).
  - Disallowed: any fabrication or schematic artifacts (no Gerbers/BOM/CPL/schematics), and no external hardware project links (OSHW/EasyEDA/etc.).

## Agent Workflow Guardrails

- Do **not** `git commit` or `git push` unless explicitly requested.
