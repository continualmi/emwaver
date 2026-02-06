# EMWaver Repository Guidelines

## Current Product Direction

EMWaver is now focused on shipping a **single, solid platform**:

- **Transport:** USB only (class-compliant **USB MIDI SysEx**, fixed 64‑byte frames)
- **Hardware:** **STM32 only** (one current-gen board)
- **Firmware:** **one** firmware binary for the platform (no board catalog, no variants)
- **Distribution:** **store-only for apps** (App Store / Play Store / Microsoft Store) + **bundled firmware payloads** (end users should not be building from source)
- **Core UX:** **Script-centered** hardware exploration (script + UI together, fast iteration, no reflashing)
- **Surface area shipped:** Android app, iOS app, macOS app, Windows app

Store distribution (apps)

- **Apple App Store**: iOS + macOS
- **Google Play Store**: Android
- **Microsoft Store**: Windows

We do **not** publish direct-download installers for end users (`.dmg`, `.apk`, `.exe`).

GitHub Actions are used for CI (and optionally deployment) of **frontend + backend** only.
We do **not** publish GitHub Releases for the apps (or for frontend/backend).

### Infrastructure (current direction)

We deploy **frontend + backend** to **Azure Container Apps**.

- **Backend**: Flask API → Azure Container App (external ingress)
- **Frontend**: Next.js (chat UI + streaming + websocket support) → Azure Container App (external ingress)
- **Container Registry**: Azure Container Registry (ACR)

CI/CD (GitHub Actions):
- Backend deploy workflow: `.github/workflows/deploy-azure-backend.yml`
- Frontend deploy workflow: `.github/workflows/deploy-azure-frontend.yml`

Deployment mechanism (current):
- GitHub Actions logs into Azure using **OIDC** (`azure/login@v2`)
- Builds + pushes images using **`az acr build`** (build happens in Azure; images stored in ACR)
- Updates the Container App revision using **`az containerapp update`**

Notes:
- `NEXT_PUBLIC_*` variables for the frontend are **build-time** (baked into the Next.js bundle). The deploy workflow passes them as **Docker build args**.
- Backend runtime configuration is via Container App environment variables (DB/Blob/auth/etc.).
- We do **not** require ACR username/password GitHub secrets for deploy; ACR pushes happen via Azure auth.

#### Domains & routing (emwavers.com)

**Cloudflare DNS (proxied/orange-cloud):**
- `app.emwavers.com` (CNAME) → Azure Container App FQDN for **emwaver-frontend**
  - `emwaver-frontend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io`
- `api.emwavers.com` (CNAME) → Azure Container App FQDN for **emwaver-backend**
  - `emwaver-backend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io`
- Apex `emwavers.com` (CNAME) → `app.emwavers.com` (so root lands on the frontend)
- `www.emwavers.com` (CNAME) → `emwavers.com`

**Azure Container Apps custom domains:**
- `emwaver-frontend` should have custom hostname `app.emwavers.com` bound with a managed certificate.
- `emwaver-backend` should have custom hostname `api.emwavers.com` bound with a managed certificate.

**Important:** Cloudflare will return **HTTP 525** if Azure is not serving a certificate for the requested hostname (SNI mismatch). This means the Azure custom domain + cert binding is required before Cloudflare proxying will work reliably.

**Azure domain verification (TXT):**
- Azure Container Apps environment uses a verification id exposed as `customDomainVerificationId`.
- Cloudflare TXT records used:
  - `asuid.app` + `asuid.api` → `<customDomainVerificationId>`
  - `_acme-challenge.app` + `_acme-challenge.api` → Azure managed cert `validationToken` values

### Azure CLI usage (agent)

When helpful for Azure resource management and troubleshooting, the agent may run `az` (Azure CLI) commands in the dev environment to inspect/configure resources.
- Prefer **read-only** commands by default.
- For **destructive or security-sensitive** actions (deletes, role changes, key rotation, public exposure), get explicit user confirmation first.

### GitHub CLI usage (agent)

When helpful for repository management, the agent may use `gh` (GitHub CLI) to perform actions like:
- setting GitHub Actions secrets/variables
- viewing workflow runs and logs
- triggering workflows

For sensitive operations (secrets, permissions, destructive actions), get explicit user confirmation first.

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

- Wireless workflows.
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
- **Apple Shared (iOS + macOS):** `apple/` (Swift packages)
- **macOS App (defacto):** `macos/` (SwiftUI)
- **Internal tooling (not shipped):** `cli/` (firmware build + DFU flash)
- **Shared assets:** `assets/` (default scripts, etc.)
- **Bundled firmware payload:** `firmware/` (e.g. `firmware/emwaver.bin`) + per-platform copies:
  - Android: `android/app/src/main/assets/firmware/emwaver.bin`
  - iOS: `ios/EMWaver/firmware/emwaver.bin`
  - Apple shared: `apple/EMWaverAppleCore/Resources/Firmware/emwaver.bin`
  - Windows: `windows/EMWaver/Assets/Firmware/emwaver.bin`
- **Website:** `frontend/` (Next.js)
- **Dev env (macOS + Windows):** `DEV_ENV.md` (developer setup checklist; not product docs)

### Repo-local utilities (dev-only)

- Image generation helper (Gemini 2.5 Flash Image): `scripts/gen_image_gemini.py`
  - Model default: `gemini-2.5-flash-image` (txt2img + img2img for edits/variations via `--in`)
  - Requires: Python 3.10+, `pip install google-genai pillow`, and `GEMINI_API_KEY` in env (or repo-root `.env`)
  - Example: `python scripts/gen_image_gemini.py --prompt "Clean product shot, dark studio" --out out.png --overwrite`
  - Example (img2img): `python scripts/gen_image_gemini.py --in ref.png --prompt "Make a subtle variation, keep composition" --out out.png --overwrite`

Notes on dev environment docs:
- `DEV_ENV.md` is a developer-only setup checklist (not end-user/product documentation).
- Use the macOS or Windows section depending on the platform.

## Repository Code Map (Deep Tree)

This map is intentionally **code-focused** (so you can find “where the thing lives” quickly). It avoids listing non-code/ops `.md` files and calls out the *actual implementation* locations for the major subsystems (USB transport, buffer core, script engine + UI renderer, DFU, Git, etc.).

> Convention: paths shown here refer to **source-of-truth** locations. Build outputs and vendored deps are called out separately so you don’t go spelunking in `target/`, `node_modules/`, etc.

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
├─ assets/
│  └─ default-scripts/                        # Canonical built-in .emw scripts
├─ cli/                                       # Internal CLI (build + flash)
├─ firmware/                                  # Bundled firmware payloads (e.g. emwaver.bin)

├─ android/
│  └─ app/src/main/
│     ├─ assets/firmware/                     # Bundled firmware payload (emwaver.bin)
│     ├─ java/com/emwaver/emwaverandroidapp/
│     │  ├─ MainActivity.java / WelcomeActivity.java
│     │  ├─ DeviceConnectionManager.java / DeviceConnectionService.java
│     │  ├─ USBService.java                  # Background USB service
│     │  ├─ UsbMidiSysex.java                # USB MIDI SysEx tunnel
│     │  ├─ NativeBuffer.java                # JNI bridge to Rust buffer core
│     │  ├─ files/                           # Local file repository (scripts/assets)
│     │  ├─ scripts/                          # Script runtime + UI tree + renderer
│     │  │  ├─ ScriptEngine.java             # JS runtime + DSL injection
│     │  │  ├─ ScriptRenderView.java         # ScriptTree → Android Views
│     │  │  ├─ ScriptTree.java               # Root UI tree
│     │  │  ├─ ScriptNode.java               # UI node model
│     │  │  ├─ ScriptNodeType.java           # Node type enum
│     │  │  └─ ScriptSignalStore.java        # Reactive signals/state
│     │  └─ ui/                               # Screens/fragments
│     │     ├─ sampler/ / packetmode/ / scripts/
│     │     ├─ emwaver/ / ism/ / rfid/
│     │     └─ flash/                         # DFU/flash UI
│     ├─ res/                                 # Layouts/drawables/navigation/etc.
│     ├─ assets/ota/                           # OTA payload(s)
│     └─ jniLibs/                              # Prebuilt native libs (if shipped)
│
├─ ios/
│  └─ EMWaver/
│     ├─ firmware/                            # Bundled firmware payload (emwaver.bin)
│     ├─ EMWaverApp.swift / ContentView.swift # SwiftUI bootstrap
│     ├─ JavaScriptEngine.swift               # Lower-level JS runtime wrapper
│     ├─ Managers/
│     │  ├─ USBManager.swift                  # USB lifecycle
│     │  ├─ UsbMidiSysex.swift                # USB MIDI SysEx tunnel
│     │  ├─ NativeBufferRust.swift            # Bridge to Rust buffer core
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
├─ apple/                                     # Shared Apple code (iOS + macOS)
│  └─ EMWaverAppleCore/                        # SwiftPM: transport + script UI model/renderer
│     └─ Resources/Firmware/                   # Bundled firmware payload (emwaver.bin)
│
├─ macos/                                     # macOS native app (SwiftUI)
│  └─ EMWaver/                                # Xcode project
│
├─ third_party/coremidi/                      # iOS CoreMIDI third-party bits
├─ scripts/align_emwaver_images.py            # Repo helper script(s)
└─ frontend/                                  # Web site (Next.js) + legacy static assets
   ├─ public/                                 # Web static assets
   ├─ src/                                    # Next.js source (app router)
   └─ legacy-static/                          # Old static site (archived)
```

Web dev (Next.js):
- `cd frontend && npm run dev`

Generated / not-source-of-truth (common):
- `**/target/`, `**/node_modules/`, `android/app/.cxx/`, `stm/**/Debug/`, `stm/**/Release/`

Fast “where is X?” index:
- **Script engines** → Android: `.../scripts/ScriptEngine.java`; Apple (iOS + macOS): `apple/EMWaverAppleCore/Sources/EMWaverScriptRuntime/ScriptEngine.swift`
- **Script UI renderers** → Android: `.../scripts/ScriptRenderView.java`; Apple (iOS + macOS): `apple/EMWaverAppleCore/Sources/EMWaverScriptSwiftUI/ScriptRenderView.swift`
- **USB MIDI SysEx tunnel** → Firmware: `stm/.../USB_DEVICE/App/usbd_midi_if.c`; Android: `.../UsbMidiSysex.java`; Apple (iOS + macOS): `apple/EMWaverAppleCore/Sources/EMWaverTransport/UsbMidiSysex.swift`
- **Shared buffer/framing core** → `crates/emwaver-buffer-core/`

## Product Spec & Goals (No Phases)

This section is the **current EMWaver spec**. It replaces the old “phase plan” framing.

### Primary Product Goal

EMWaver is a **script-first hardware exploration control plane**.

- Users explore hardware by writing/running **`.emw` scripts**.
- A script defines both:
  - device/hardware interactions, and
  - a UI that makes the script usable/repeatable.

The product is not “a firmware IDE” and not “a user-facing MCU toolchain wrapper”.

### Execution Contract (the only first-class primitive)

- **Run a `.emw` file** against a connected device.
- Scripts own the UI via `UI.*` + `UI.render(...)`.
- Script output is surfaced through UI/log components and saved artifacts (signals, files).

We intentionally avoid extra modes:
- No REPL.
- No string-eval execution (`-c`).
- No user-facing CLI workflows.

### Storage Model (Local-first + Optional Cloud)

- **Local-first always**:
  - scripts are stored locally,
  - signals/artifacts are stored locally.
- **Sign-in is optional**.
- When signed in, the app performs **sync/backup** to cloud.

### Cloud Sync (Files)

**Auth contract (backend):**
- Clients call authenticated endpoints with `Authorization: Bearer <firebase_id_token>`.
- Backend verifies Firebase ID tokens and scopes all access by `uid`.

**Storage architecture (shipping direction):**
- **Azure Blob Storage** stores the file bytes at: `u/<firebase_uid>/<name>`.
- **Postgres** stores the authoritative file index + metadata in `user_files`.
  - `firebase_uid`, `name`, `blob_key`, `mtime_ms`, `size_bytes`, `content_type`, `etag`.
- **Flat namespace:** `name` must not contain `/` (no folders/prefixes in v1).
- **Legacy:** the old `files` table is deprecated and should not exist in new DBs.

**Client storage (shipping direction):**
- Android stores *all* user files in a single local folder (`filesDir/scripts/`).
- UI views filter by extension:
  - scripts: `.emw`
  - signals/artifacts: `.raw`, `.txt`

**Sync policy (v1, intentionally simple):**
- List everything every time.
- Compare by filename + `mtime_ms`.
- **Newer wins**.
- No backcompat/versioning.

### Web Dashboard (Fast Feedback Loop)

We maintain a **Next.js Dashboard** (`/cloud`) as a first-class development surface:
- Account (Firebase login/logout)
- File management (list/view/upload/delete/edit)
- Script UX iteration (web preview/runtime)
- (next) agent + remote sessions surfaces

This dashboard exists to speed iteration without waiting on native app rebuild/release cycles.

### Remote Sessions (Control From Anywhere)

Core idea: **any running EMWaver app instance can be a Host Session**.

- A Host Session is an app that is signed in and running.
- If a USB EMWaver device is attached to that host, it can bridge real hardware.
- Other surfaces can drive a Host Session under the same account:
  - host → host (desktop app controlling another desktop app)
  - mobile → host
  - and later web → host

**Transport direction:**
- WebSocket from clients to backend.
- Backend routes messages to Host Sessions for the same `uid`.

### Web UI Runtime (Browser-rendered Script UI)

Direction: the frontend will be able to **render EMWaver script UI in the browser**.

- Styling is web-native; **functional equivalence** is the goal.
- The same script UI/events contract is used by humans and agents.
- Later, device I/O and UI events can be routed over Remote Sessions.

### Agents (Layered)

Agents are not a separate control path; they operate through the same primitives:
- run scripts
- observe UI + logs + artifacts
- emit UI events / parameter changes

Placement is layered:
- **Cloud agent** (high power models) for heavy reasoning and automation.
- **Local-on-host agent** (smaller model) for low latency, offline, privacy-sensitive work.

### Long-term Hardware Direction: EMArm

We expect a next product tentatively called **EMArm**:
- a machine/rig that an agent can control remotely
- explicitly bridging **high-power hosts + cloud connectivity** to **low-level electronics**
  (modules, sensors, actuators) via USB-connected EMWaver devices.

## Project Structure & Module Organization

STM32 firmware lives in `stm/` (CubeMX/CubeIDE project). Treat CubeMX-generated output as generated code; keep handwritten logic in intended user-edit regions and prefer regeneration over manual edits to generated layers.

Apps live under `android/`, `ios/`, and `macos/`.

## Transport / Buffer Model

EMWaver uses **fixed 64-byte framing** over a USB MIDI SysEx tunnel, with an append-only RX capture and cursor parsing model implemented in `crates/emwaver-buffer-core/`.

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

- **Functional parity, native rendering**: the same `.emw` script must be functionally equivalent across Android/iOS/Desktop, but UI is rendered using platform-native controls and platform-default styling. Visual parity is not a goal (and differences are expected).
- **Share core logic when possible**: prefer shared implementation of protocol/buffering/compression (e.g. Rust buffer core), shared `.emw` scripts + bootstrap, and shared DFU/bootloader tooling when feasible, to keep script behavior and device semantics aligned across platforms.
- **Cross-platform semantics**: the Script API and observable runtime behavior must be the same across Android/iOS/Desktop (avoid host-dependent sync/async differences).
- **Sync-only execution**: scripts and the standard library are strictly synchronous across all platforms (no Promises, no `async`/`await`).
- **Unified scripting engine**: ScriptEngine is the single runtime.
- **In-script logging**: scripts surface output through script UI components.

### Apple Desktop Direction (macOS SwiftUI)

We are converging the Desktop experience (starting with macOS) toward a **native-only UI** to avoid WebView overhead and IPC/serialization bottlenecks.

Core motivation:

- WebUI + Rust bridges require cross-boundary transport and often **full UI-tree serialization** (JSON), which becomes a bottleneck for high-frequency UI updates during hardware exploration.

Apple target architecture (mirrors Android/iOS):

- **One process**: SwiftUI renderer + JavaScriptCore runtime + CoreMIDI transport in-process.
- **UI thread owns UI**: all UI updates occur on the SwiftUI main thread.
- **Script worker**: scripts execute off-main; only minimal UI events are marshaled to the main thread.
- **Typed UI model**: avoid JSON UI-tree transport; prefer typed models or small typed “diff” events.
- **Shared Apple code**: keep iOS + macOS parity via Swift packages in `apple/`.

### Windows Desktop Direction (WinUI 3, Windows 11)

We want a **Windows-only, native** desktop app that runs extremely well on **Windows 11**.

Windows target architecture (mirrors Android/iOS/macOS):

- **One process**: WinUI 3 renderer + embedded script runtime + Windows MIDI transport in-process.
- **UI thread owns UI**: UI updates remain on the WinUI dispatcher thread.
- **Script worker**: scripts execute off-UI-thread; only UI events/state deltas are marshaled onto the UI thread.
- **Shared Rust buffer core**: reuse `crates/emwaver-buffer-core` via a Windows FFI DLL (C ABI) so buffering/status/sampler compression and TX pacing policy stay identical across platforms.
- **Transport remains native**: USB MIDI SysEx I/O is implemented with Windows APIs; Rust is used for pure logic only.

## Cross-Cutting Practices

- Keep changes scoped and avoid bundling unrelated work.
- UI across the product (script-rendered UI and “app UI”) should prefer platform-native elements over custom widgets/skins; aim for a purist, default-native look that stays elegant.
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

### Windows (`/windows`)

- Native Windows 11 app (WinUI 3).
- Keep the same `.emw` script semantics as Android/iOS/macOS (sync-only).
- USB MIDI SysEx transport is native Windows; shared buffering/compression/pacing uses `crates/emwaver-buffer-core` via `crates/emwaver-buffer-windows-ffi`.

Windows code map (navigate fast)

Workspace / project

- Solution: `windows/EMWaver.sln`
- App project: `windows/EMWaver/EMWaver.csproj`
  - Bundled scripts are linked from `assets/default-scripts/*.emw` into the app output as `Assets/DefaultScripts/*.emw`.
  - Native DLLs under `windows/EMWaver/Native/*.dll` are copied to the app root (so `DllImport` can find them).

App bootstrap + shell

- Entry: `windows/EMWaver/Program.cs`
- App object: `windows/EMWaver/App.xaml`, `windows/EMWaver/App.xaml.cs`
- Main window + top command bar: `windows/EMWaver/MainWindow.xaml`, `windows/EMWaver/MainWindow.xaml.cs`
  - Hosts the page frame (`ContentFrame`) and wires toolbar state from pages.

Pages

- Scripts (main UX): `windows/EMWaver/Pages/ScriptsPage.xaml`, `windows/EMWaver/Pages/ScriptsPage.xaml.cs`
  - Script list + preview renderer + **plain text editor** (`TextBox` named `EditorBox`).
  - Preview and editor are mutually exclusive (toggle in the page).
- Device: `windows/EMWaver/Pages/DevicePage.xaml`, `windows/EMWaver/Pages/DevicePage.xaml.cs`
- Settings: `windows/EMWaver/Pages/SettingsPage.xaml`, `windows/EMWaver/Pages/SettingsPage.xaml.cs`

Script storage

- Repository: `windows/EMWaver/Services/ScriptRepository.cs`
  - Local scripts dir: `%LocalAppData%\EMWaver\Scripts`
  - Bundled scripts dir (in app output): `Assets/DefaultScripts`
  - Bundled firmware payload (in app output): `Assets/Firmware/emwaver.bin`
  - Bundled scripts are read-only; users can copy them to local.

Scripting runtime + UI renderer

- JS runtime + host bridges: `windows/EMWaver/Scripting/ScriptEngine.cs` (Jint)
- Script UI model: `windows/EMWaver/Scripting/ScriptModel.cs`
- Renderer: `windows/EMWaver/Scripting/Render/ScriptRenderer.cs`
- Plot + helpers: `windows/EMWaver/Scripting/Render/ScriptPlotControl.cs`, `windows/EMWaver/Scripting/Render/ScriptPropParsers.cs`, `windows/EMWaver/Scripting/PlotBufferStore.cs`

Transport / device

- Device manager (high-level): `windows/EMWaver/Services/WindowsDeviceManager.cs`
- USB MIDI SysEx tunnel: `windows/EMWaver/Services/UsbMidiSysex.cs`
- Service singleton wiring: `windows/EMWaver/Services/AppServices.cs`

Firmware update / DFU

- DFU helpers + device-side update flow: `windows/EMWaver/Services/Dfu.cs`
- Update orchestration/state: `windows/EMWaver/Services/FirmwareUpdateManager.cs`
- UI: `windows/EMWaver/Dialogs/FirmwareUpdateDialog.xaml`, `windows/EMWaver/Dialogs/FirmwareUpdateDialog.xaml.cs`

Cloud (auth + files)

- Cloud feature wiring: `windows/EMWaver/Services/Cloud/CloudAuthManager.cs`, `windows/EMWaver/Services/Cloud/CloudConfig.cs`
- Firebase auth: `windows/EMWaver/Services/Cloud/FirebaseAuthService.cs`
- Google OAuth (PKCE): `windows/EMWaver/Services/Cloud/GoogleOAuthPkce.cs`, `windows/EMWaver/Services/Cloud/PkceUtil.cs`
- Files client: `windows/EMWaver/Services/Cloud/CloudFilesClient.cs`

Native interop

- Rust buffer DLL bridge: `windows/EMWaver/Interop/NativeBufferRust.cs`, `windows/EMWaver/Interop/EmwBufferNative.cs`
  - Generated DLL (do not commit): `windows/EMWaver/Native/emwaver_buffer_windows.dll`
- Legacy/unused (do not use as product dependency): `windows/EMWaver/Interop/ScintillaWin32.cs`

> **Agent Note:** In this agent environment on Windows, avoid running builds (MSBuild/WinUI XAML compilation). After code changes, wait for the user to build/run locally; this environment frequently hits file locks/permission issues.

Windows dev prerequisites (Rust buffer core)

- The WinUI app can do basic device comms without Rust, but buffer monitor/sampler parity requires the Rust DLL.
- Install Rust (via rustup) + MSVC C++ build tools so `cargo` can build a Windows `cdylib`.
- Build + copy the DLL into the app with:
  - `powershell -ExecutionPolicy Bypass -File windows/build-rust-buffer-core.ps1 -Configuration Debug -Target x86_64-pc-windows-msvc`
- Output location: `windows/EMWaver/Native/emwaver_buffer_windows.dll` (generated; do not commit).

### CLI (`/cli`)

- Rust crate/binary (`emw` → `emwaver`) kept intentionally minimal for internal/dev use (not shipped).
- Shared Rust core lives under `crates/`:
  - `crates/emwaver-buffer-core` (fixed-size lanes, append-only RX capture, cursor parsing, `BS` status parsing, sampler viewport compression)
  - `crates/emwaver-buffer-ios-ffi` (iOS)
  - `crates/emwaver-buffer-android-jni` (Android)
  - `crates/emwaver-buffer-windows-ffi` (Windows)
- Current scope: firmware `build` and DFU `flash` only.

#### Script REPL

Removed (scripts are run via the apps).

### Website (`/frontend`)

- Next.js website.
- This is the only public-facing documentation surface (we no longer ship MkDocs from `docs/`).

#### Hardware pages

- **Order** (`/order`): placeholder UX for device ordering.
  - No vendor branding.
  - **No fabrication/manufacturing artifacts** are published (no Gerbers/BOM/CPL/pick-and-place/case STLs/CAD exports).

## Agent Workflow Guardrails

- Prefer making changes in working tree first and showing a diff/summary.
- **After significant changes, you MUST `git commit` + `git push`** (don’t wait to be asked), unless the user explicitly says not to.
- For small or speculative tweaks, ask before committing/pushing.
├─ crates/                                   # Shared Rust crates (used by apps)
│  ├─ emwaver-buffer-core/                    # 64B framing + RX capture + cursor parsing
│  │  └─ src/{packet,buffer,status,sampler,tx}.rs
│  ├─ emwaver-dfu/                            # DFU/update helpers
│  ├─ emwaver-dfu-helper/                     # DFU helper binary (used by macOS app)
│  ├─ emwaver-buffer-ios-ffi/                 # iOS FFI wrapper (staticlib)
│  │  ├─ include/emwaver_buffer_ios.h
│  │  └─ src/lib.rs
│  ├─ emwaver-buffer-android-jni/             # Android JNI wrapper (cdylib)
│  │  └─ src/lib.rs
│  ├─ emwaver-buffer-windows-ffi/             # Windows FFI wrapper (cdylib)
│  │  ├─ include/emwaver_buffer_windows.h
│  │  └─ src/lib.rs
│  
│  └─ regress/                                # Regex engine crate (used/benchmarked internally)
