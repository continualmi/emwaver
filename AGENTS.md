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

## Repository Code Map (Deep Tree)

This map is intentionally **code-focused** (so you can find “where the thing lives” quickly). It avoids listing non-code/ops `.md` files and calls out the *actual implementation* locations for the major subsystems (USB transport, buffer core, script engine + UI renderer, DFU, Git, etc.).

> Convention: paths shown here refer to **source-of-truth** locations. Build outputs and vendored deps are called out separately so you don’t go spelunking in `target/`, `node_modules/`, `docs/site/`, etc.

```text
.
├─ stm/
│  └─ emwaver-firmware/                      # THE firmware project (STM32)
│     ├─ Core/
│     │  ├─ Inc/
│     │  │  ├─ emw_proto.h                   # Firmware protocol types/opcodes
│     │  │  ├─ emwaver_usb_io.h              # USB I/O interface used by app logic
│     │  │  ├─ main.h                        # CubeMX main header + user glue
│     │  │  ├─ stm32f0xx_it.h                # IRQ handler declarations
│     │  │  └─ stm32f0xx_hal_conf.h          # HAL config
│     │  ├─ Src/
│     │  │  ├─ main.c                        # Main firmware entry + app loop
│     │  │  ├─ stm32f0xx_it.c                # IRQ handlers
│     │  │  ├─ stm32f0xx_hal_msp.c           # HAL MSP init
│     │  │  ├─ system_stm32f0xx.c            # System clock init
│     │  │  └─ syscalls.c / sysmem.c         # Newlib stubs
│     │  └─ Startup/
│     │     └─ startup_stm32f042g6ux.s       # Startup assembly
│     ├─ USB_DEVICE/
│     │  ├─ App/
│     │  │  ├─ usb_device.c/.h               # USB device init/registration
│     │  │  ├─ usbd_desc.c/.h                # USB descriptors
│     │  │  ├─ usbd_midi.c/.h                # USB MIDI class implementation
│     │  │  └─ usbd_midi_if.c/.h             # MIDI interface glue (SysEx tunnel)
│     │  └─ Target/
│     │     └─ usbd_conf.c/.h                # USB low-level config/hooks
│     ├─ Drivers/                            # STM32 HAL + CMSIS (vendored)
│     ├─ Middlewares/                        # ST USB Device library (vendored)
│     ├─ Debug/ Release/                     # Build output dirs (generated)
│     └─ *.ioc / .settings/                  # CubeMX/CubeIDE project metadata
│
├─ app/                                      # Desktop app (Tauri) + shared Rust crates + CLI
│  ├─ src/                                   # Desktop UI (TypeScript/React)
│  │  ├─ main.tsx                            # UI bootstrap
│  │  ├─ App.tsx                             # App shell + routing-ish composition
│  │  ├─ components/
│  │  │  ├─ HomePage.tsx                     # Landing/home
│  │  │  ├─ ErrorBoundary.tsx
│  │  │  ├─ SamplerFragment.tsx              # Sampler screen
│  │  │  ├─ ISMFragment.tsx                  # ISM screen
│  │  │  ├─ ScriptsFragment.tsx              # Scripts screen
│  │  │  ├─ SettingsFragment.tsx             # Settings screen
│  │  │  ├─ scripts/
│  │  │  │  └─ ScriptUIRenderer.tsx          # Script UI renderer (ScriptTree → React)
│  │  │  └─ workspace/                       # “Workspace” multi-panel UI
│  │  │     ├─ hooks/                        # Workspace-specific hooks
│  │  │     ├─ main/                         # Main panel(s) (script editor/preview/etc.)
│  │  │     ├─ sidebar/                      # File tree + tools sidebar
│  │  │     ├─ terminal/                     # Terminal/PTY UI components
│  │  │     └─ top/                          # Top bar + global controls
│  │  └─ utils/
│  │     ├─ DeviceContext.tsx                # Device/session context
│  │     ├─ AppDialogContext.tsx             # Dialog plumbing
│  │     ├─ ScriptEngine.ts                  # Desktop ScriptEngine (JS sandbox + DSL)
│  │     ├─ useBackendScript.ts              # Hooks/bridge for backend script execution
│  │     ├─ tauri.ts                         # Tauri invoke/bridge helpers
│  │     └─ monacoTheme.ts                   # Editor theming
│  │
│  ├─ src-tauri/                              # Desktop native host (Rust, Tauri)
│  │  ├─ src/
│  │  │  ├─ main.rs                          # Tauri entrypoint
│  │  │  ├─ lib.rs                           # Tauri commands + app state wiring
│  │  │  ├─ buffer.rs                        # Rust-side buffer plumbing
│  │  │  ├─ script_runtime.rs                 # Desktop script runtime (host bridges + eval)
│  │  │  ├─ pty.rs                           # PTY/terminal integration
│  │  │  ├─ git.rs                           # Git commands exposed to UI/CLI
│  │  │  └─ desktop_ipc.rs                    # Desktop↔CLI mailbox bridge
│  │  ├─ capabilities/                       # Tauri capability manifests
│  │  ├─ resources/                          # Packaged runtime resources (e.g. OTA)
│  │  ├─ firmware/                           # Firmware payload(s) shipped w/ desktop app
│  │  └─ icons/                              # App icons
│  │
│  ├─ crates/                                 # Shared Rust crates (desktop + mobile)
│  │  ├─ emwaver-buffer-core/                 # 64B framing + RX capture + cursor parsing
│  │  │  └─ src/{packet,buffer,status,sampler,tx}.rs
│  │  ├─ emwaver-device-core/                 # Device protocol + SysEx tunnel helpers
│  │  │  └─ src/{midi_sysex,bridge}.rs
│  │  ├─ emwaver-desktop-ipc/                 # Desktop↔CLI IPC format
│  │  ├─ emwaver-dfu/                         # DFU/update helpers
│  │  ├─ emwaver-git/                         # Git integration helpers
│  │  ├─ emwaver-buffer-ios-ffi/              # iOS FFI wrapper (XCFramework)
│  │  │  ├─ include/emwaver_buffer_ios.h
│  │  │  └─ src/lib.rs
│  │  ├─ emwaver-buffer-android-jni/          # Android JNI wrapper
│  │  │  └─ src/lib.rs
│  │  ├─ coremidi/                            # Rust CoreMIDI bindings
│  │  └─ regress/                             # Regex engine crate (used/benchmarked internally)
│  │
│  ├─ cli/                                    # Rust CLI (helper; does not own USB)
│  │  ├─ src/{main,lib,cli,desktop_ipc,repl}.rs
│  │  ├─ tests/                               # CLI tests
│  │  └─ resources/{ota,vibe}/                # Bundled resources
│  │
│  ├─ public/{default-scripts,device-icons}/  # Bundled UI assets (incl starter scripts)
│  └─ dist/ / node_modules/ / src-tauri/target/ # Generated build/deps
│
├─ android/
│  └─ app/src/main/
│     ├─ java/com/emwaver/emwaverandroidapp/
│     │  ├─ MainActivity.java / WelcomeActivity.java
│     │  ├─ DeviceConnectionManager.java / DeviceConnectionService.java
│     │  ├─ USBService.java                  # Background USB service
│     │  ├─ UsbMidiSysex.java                # USB MIDI SysEx tunnel
│     │  ├─ NativeBuffer.java                # JNI bridge to Rust buffer core
│     │  ├─ files/                           # Local file repository (scripts/assets)
│     │  ├─ github/                           # GitHub auth/cache/diff models + client
│     │  ├─ scripts/                          # Script runtime + UI tree + renderer
│     │  │  ├─ ScriptEngine.java             # JS runtime + DSL injection
│     │  │  ├─ ScriptRenderView.java         # ScriptTree → Android Views
│     │  │  ├─ ScriptTree.java               # Root UI tree
│     │  │  ├─ ScriptNode.java               # UI node model
│     │  │  ├─ ScriptNodeType.java           # Node type enum
│     │  │  └─ ScriptSignalStore.java        # Reactive signals/state
│     │  └─ ui/                               # Screens/fragments
│     │     ├─ sampler/ / packetmode/ / scripts/
│     │     ├─ emwaver/ / ism/ / rfid/ / git/
│     │     └─ flash/                         # DFU/flash UI
│     ├─ res/                                 # Layouts/drawables/navigation/etc.
│     ├─ assets/ota/                           # OTA payload(s)
│     └─ jniLibs/                              # Prebuilt native libs (if shipped)
│
├─ ios/
│  └─ EMWaver/
│     ├─ EMWaverApp.swift / ContentView.swift # SwiftUI bootstrap
│     ├─ JavaScriptEngine.swift               # Lower-level JS runtime wrapper
│     ├─ Managers/
│     │  ├─ USBManager.swift                  # USB lifecycle
│     │  ├─ UsbMidiSysex.swift                # USB MIDI SysEx tunnel
│     │  ├─ NativeBufferRust.swift            # Bridge to Rust buffer core
│     │  ├─ GitService.swift + GitHub*.swift  # Git/GitHub integration
│     │  └─ FileService.swift / SettingsManager.swift / etc.
│     ├─ Scripts/
│     │  ├─ ScriptEngine.swift                # iOS ScriptEngine (DSL + host bridges)
│     │  ├─ ScriptRenderView.swift            # ScriptTree → SwiftUI views
│     │  ├─ ScriptTypes.swift                 # ScriptTree/Node types
│     │  └─ ScriptPreviewManager.swift        # Preview/orchestration
│     ├─ Views/                               # SwiftUI screens
│     ├─ ViewModels/                          # View models
│     ├─ Models/                              # Data models
│     ├─ Native/                              # Helper scripts/build glue for Rust core
│     ├─ DefaultScripts/                      # Bundled starter scripts
│     └─ ota/                                 # OTA payload(s)
│
├─ third_party/coremidi/                      # iOS CoreMIDI third-party bits
├─ scripts/align_emwaver_images.py            # Repo helper script(s)
└─ frontend/                                  # Web/marketing assets
```

Generated / not-source-of-truth (common):
- `**/target/`, `**/node_modules/`, `app/dist/`, `android/app/.cxx/`, `stm/**/Debug/`, `stm/**/Release/`

Fast “where is X?” index:
- **Script engines** → Desktop: `app/src/utils/ScriptEngine.ts`; Android: `.../scripts/ScriptEngine.java`; iOS: `ios/EMWaver/Scripts/ScriptEngine.swift`
- **Script UI renderers** → Desktop: `app/src/components/scripts/ScriptUIRenderer.tsx`; Android: `.../scripts/ScriptRenderView.java`; iOS: `ios/EMWaver/Scripts/ScriptRenderView.swift`
- **USB MIDI SysEx tunnel** → Firmware: `stm/.../USB_DEVICE/App/usbd_midi_if.c`; Android: `.../UsbMidiSysex.java`; iOS: `Managers/UsbMidiSysex.swift`; Desktop: `app/crates/emwaver-device-core/src/midi_sysex.rs`
- **Shared buffer/framing core** → `app/crates/emwaver-buffer-core/`

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
