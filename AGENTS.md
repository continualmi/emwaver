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

We treat `.emw` as the first-class format for these scripts.

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
- Binary opcode protocol inside the 64B frames (no command strings)
- status/flow-control frames (e.g. `BS` for retransmit pacing)

### Mini-Frame (Single-Callback) Plan

We are restructuring the USB MIDI SysEx tunnel to be:

- Predictable: 1 USB OUT callback == 1 EMW frame
- Simple: no SysEx accumulation, no multi-transaction decode bursts
- Low CPU/IRQ load: bounded work inside the USB receive callback

Motivation

- The current 128B superframe (2x64 lanes) requires a full SysEx message that typically spans multiple USB bulk OUT transactions.
- That forces the firmware to accumulate SysEx bytes until `0xF7`, then run a large decode/copy burst.
- During retransmit (timed output), this receive-side burst work competes with timer ISR timing and can create glitches.

New on-wire frame (fixed-size)

- Always send exactly 64 USB bytes per OUT transaction.
- This is 16 USB-MIDI event packets (4 bytes each).
- Each event packet carries 3 MIDI bytes => 48 MIDI bytes per transaction.
- Those 48 MIDI bytes are a complete SysEx message (no spanning):
  - `F0 7D 'E' 'M' 'W' <42 encoded bytes> F7`
  - Note: we drop the previous `0x01` version byte to fit cleanly.
- The `<42 encoded bytes>` use the existing 7-bit prefix/MSB scheme.
- 42 encoded bytes decode to 36 raw bytes.
- 36 raw bytes split into two 18-byte lanes:
  - cmd lane: 18 bytes
  - stream/sampler lane: 18 bytes

Behavioral rules

- Firmware RX: single-pass decode directly in the USB MIDI receive callback.
  - No `sysex_buf`, no `sysex_feed_byte`, no `handle_complete_sysex`.
  - If `Len != 64` or header mismatches, ignore the transaction.
- Firmware protocol: all requests/responses must fit within the 18-byte cmd lane.
  - The host is responsible for not sending oversized requests.
  - Firmware does not fragment and does not attempt to “detect/repair” oversize requests.

Throughput target

- Retransmit needs ~100 kbit/s (~12.5 kB/s).
- With an 18-byte stream lane, sending 1 frame per 1ms yields ~18 kB/s (~144 kbit/s), which meets the target.

## Scripts

Scripts are user-authored extension bundles (manifest + EMWaver scripts) that plug into the Script Engine sandbox.

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
- The CLI does not own the USB MIDI connection; it asks the Desktop app to execute scripts and device packet I/O.

#### Script REPL (Packet-Only)

EMWaver's "REPL" is a JavaScript-based evaluator for EMWaver scripts (".emw") with a Python-like workflow.

- It evaluates EMWaver code (ScriptEngine) and relies on host-provided bridge functions.
- Device I/O from scripts is packet-only via `_scriptSendPacket`.
- Do not add or re-introduce ASCII command-string transports (no `_scriptSendCommandString`, no `send_command`, no firmware string parsing).

If you need a quick device sanity check, prefer a tiny `.emw` snippet in the REPL (e.g. `await device.version()`), not a bespoke command-string path.

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
