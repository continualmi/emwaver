# EMWaver Repository Guidelines

This file is intentionally concise, but it must preserve EMWaver's core vision and strategic product direction.

EMWaver is a **Continual MI** project.

`AGENTS.md` is the repo-wide source of truth for:
- product vision,
- non-negotiable platform decisions,
- high-level business/platform strategy,
- documentation routing (which folder README to use),
- contribution guardrails.

Implementation details belong in folder-level `README.md` files.

---

## 0) Automation Workflow

- Keep validation logs compact. `xcodebuild`, ESP-IDF, and other embedded build systems can emit very large logs that waste conversation context. Prefer quiet or filtered output by default, such as `xcodebuild -quiet ...`, `idf.py build 2>&1 | tail -120`, or focused `rg` filters for `error:`, `warning:`, and file paths. Only capture or paste full build logs when the compact output is insufficient to diagnose a failure.

---

## 1) Product Vision (core)

EMWaver is a **local-first**, open-source electronics platform by **Continual MI**. It turns supported MCU boards into a scriptable hardware lab through local apps, managed firmware, JavaScript scripts, native script UI, and a desktop MCP bridge for MCP clients.

Core direction:
- **Business model:** open-source core plus future paid Continual model inference. Revenue should come from model/API usage and bundled Continual offerings, not from accounts, hosted cloud control, or gating local hardware access.
- **No EMWaver accounts/cloud:** EMWaver itself should not require or maintain product accounts, cloud activation, hosted relay, cloud script storage, cloud sync, or subscription checks for core use.
- **Local-first core:** users should be able to run local JavaScript scripts without a Continual MI account, EMWaver account, cloud activation, hosted relay, or subscription check.
- **Local data ownership:** scripts and core local state should live on the user's device. Do not add cloud script storage, cloud script sync, or account-backed local project storage to the open-source core path.
- **Remote control posture:** native apps should not be positioned as Continual-hosted remote-control hosts for the open-source core. Native apps stay self-contained. Remote use should be user-owned SSH/VPN/Tailscale/port-forwarding around the local tool.
- **Transport:** managed multi-transport platform. USB remains first-class for host-backed boards; supported boards may also expose BLE and Wi-Fi when the platform/runtime design requires it.
- **Hardware:** multiple supported MCU boards (currently STM32-based, with ESP32 support returning; e.g., STM32F042 EMWaver board and ESP32-S3 class devices). Users bring their own compatible board.
- **Hardware repo direction:** EMWaver should become a single open-source monorepo, with imported hardware design repos preserved under `hardware/`.
- **Firmware:** per-board firmware targets managed by the platform. Users never build or flash firmware manually; apps should handle firmware setup and updates where practical.
- **UX:** script-first hardware exploration (instant run; no user build/flash loop).
- **MCP:** Desktop apps expose a local MCP tool surface so MCP clients can drive the existing engine, scripts, transports, and console output. Mobile apps stay local script runners without an MCP listener.
- **Client surfaces:** iOS and Android (V1 primary), macOS and Windows (active desktop surfaces), Linux (native desktop app in progress).
- **UX:** script-first hardware exploration (instant run; no user build/flash loop). The phone is the primary device users carry already; desktop apps are the advanced workbench and MCP bridge.
- **Distribution:** mobile store distribution for iOS and Android (V1 primary), with Android APK as an alternate direct install path. macOS DMG, Windows installer/ZIP, and staged Linux packages cover desktop use.

---

### V1 Platform Priorities

V1 is mobile-first. The phone is the portable hardware lab users always have with them. Desktop apps remain the advanced bench surface and the place where MCP clients attach.

- **iOS** — V1 primary. App Store distribution. USB-C iPhones and iPads for direct board connection.
- **Android** — V1 primary. Google Play + APK direct download. USB host mode on all modern Android devices. Industrial field-service path through rugged Android devices (Zebra, Honeywell, Samsung Rugged).
- **macOS** — V1 development/advanced surface. Firmware flashing, multi-device bench testing, long automation runs. DMG distribution.
- **Windows** — active desktop surface. Installer/ZIP distribution; validation still requires a Windows workstation/toolchain.
- **Linux** — native Rust + GTK4/libadwaita app in progress. Linux is back as a native app, not as a browser/daemon path.

Firmware strategy: boards should arrive pre-flashed or require a one-time desktop flash. After that, daily use is phone-only.

## 2) Platform Thesis

### The Core Thesis

1. **Local-first electronics platform** — EMWaver uses local apps as the default hardware-control path.
2. **Software-first platform** — the product is the software stack (apps, firmware, runtime, scripts, script UI, and MCP tool surface), not the hardware. Users supply their own supported MCU board.
3. **MCP-ready platform** — MCP clients are first-class users of the local desktop tool surface.
4. **Best beginner experience** — buy a cheap supported board, install EMWaver, plug in, and start exploring without accounts, cloud activation, or firmware toolchains.

### Explicit Tradeoffs

We intentionally give up:
- dependency on hardware sales for revenue or launch,
- paid gating for local hardware control,
- mandatory hosted relay/cloud paths for core use,
- Continual-hosted native app remote control as a core cross-platform feature,
- single-board hardware monopoly,
- end-user firmware build/flash customization loops,
- "MCU toolchain as required user workflow."

### What We Gain

- Launch without hardware supply chain.
- Adoption from day one through an open-source local core.
- Revenue through paid Continual inference and bundled model access.
- Multiple supported boards, one unified UX.
- Mobile-first platforms (iOS, Android) — the device users already carry.
- MCP-assisted exploration loops through the desktop bridge.
- Larger addressable market (every compatible board owner, every phone owner).
- Industrial field adoption path through Android rugged devices (Zebra, Honeywell, Samsung Rugged).

---

## 3) Important Strategic Notes (high-level)

### Business model (open-source core + model inference)

- **Open-source core**: local runtime, firmware payloads, scripts, and hardware support should be useful without payment or account sign-in.
- **Paid inference/API**: future paid value comes from Continual models that are good at using the EMWaver MCP tools, writing scripts, debugging electronics workflows, and interpreting hardware traces.
- **No EMWaver cloud product**: do not plan accounts, hosted relay, sync, teams, classrooms, remote fleet behavior, or cloud dashboards as part of the EMWaver core. Any future network service belongs to focused Continual inference unless a later product decision explicitly reopens cloud services.
- **No cloud script storage by default**: local scripts should be opened/saved from the user's filesystem or app-local storage. Do not build script sync as a default product assumption.
- **AI credits/usage**: model inference remains a metered resource.
- **Hardware is optional**: the EMWaver board is a future premium option ("coming soon"), not a launch dependency. Third-party supported boards are first-class.

### Device trust model

- Local hardware control must not be gated by backend activation or account ownership.
- EMWaver should move away from hardware-UID identity as a product requirement. Local control should work immediately without reading immutable board IDs for activation, minting, ownership, device limits, or gates.
- Do not introduce hosted device registration, device limits, device minting, or backend ownership checks for core EMWaver hardware control.
- Backend enforcement applies only to paid model/API usage, not to the open-source local core.

(Implementation details live in `macos/README.md`; public static web pages live in `../society` under `/emwaver`.)

### Supported boards

- The platform supports multiple MCU targets. Each target needs a firmware implementation of the transport/runtime model appropriate to that board class, plus platform identity and managed update support.
- Current/planned targets: STM32F042 (EMWaver board — coming soon) and ESP32-S3 class targets.
- Adding a new supported board = porting firmware + adding its binary to the app bundle.
- Users see a unified experience regardless of which board they use.

### Desktop MCP direction

- Desktop apps should expose an in-app local MCP server as the canonical model/client interface. The MCP surface routes into the same script engine, console capture, device transports, and filesystem script roots used by the human UI.
- MCP belongs on desktop only for now: macOS, Windows, and native Linux. iOS and Android keep user script import/app-local storage but do not host an external listening endpoint.
- MCP tools should be model-friendly and structured: clear names, typed arguments, predictable JSON results, and recovery-oriented error messages.
- Local MCP access must remain local-first and user-controlled. It must not require EMWaver accounts, cloud activation, backend ownership checks, hosted relay, or paid local hardware access.
- Do not ship production system prompts, proprietary JavaScript instruction packs, hidden board recipes, provider-routing logic, or metering policy in this repo.
- Do not change MDL gameplay, MDL `backend-api` behavior, or Continual model internals merely to make an EMWaver tool flow work. External model/API work belongs at the public inference boundary unless the user explicitly asks for MDL/backend implementation work.

### Distribution and release posture

- Mobile is V1 primary: App Store for iPhone/iPad, Google Play for Android, with Android APK as an alternate direct install path.
- macOS DMG for development and advanced use.
- Windows installer EXE and ZIP paths are active desktop distribution targets. Linux packaging is staged with the native app.
- GitHub Releases may host preview downloadable artifacts; the public install page should present mobile first.
- EMWaver uses one shared product version across native platforms. Keep the root `VERSION` file, iOS/macOS marketing versions, Android versionName, Linux package version, and Windows app/installer version aligned.
- Release tags use bare SemVer `X.Y.Z` and should match the root `VERSION` value. Direct-download release workflows are run manually and update same-named assets on the existing GitHub Release for that tag; App Store and Google Play submissions remain separate workflows because they have store-specific review and track state.

### Long-term hardware direction

- The EMWaver board may ship as a premium, purpose-built option when ready.
- Future hardware evolution (e.g., EMArm direction) should not fragment the multi-board platform UX.

### Strategic role inside Continual MI

- EMWaver is an important product surface, but it is not the company's primary benchmark for continual intelligence.
- MDL is currently the main mission vehicle for continual-learning evaluation and long-horizon product loops.
- EMWaver work should stay focused, launch-closing, and product-driven so it does not consume the bandwidth needed for MDL and Continual model progress.

---

## 4) Documentation Ownership

## Keep in `AGENTS.md`
- Vision and long-term direction.
- Hard platform constraints and policy-level decisions.
- Repo-wide guardrails.
- Folder documentation map.

## Keep in folder `README.md`
- Architecture internals.
- File/class breakdowns.
- Protocol/opcode specifics.
- Build/run/test instructions.
- Platform-specific flows.
- Troubleshooting and implementation caveats.

---

## 5) Documentation Map (authoritative)

Use the local README first when working in a folder:

- `README.md` (repo root) — public open-source overview, website links, repo map, and doc index
- `README.txt` (repo root) — compatibility pointer to `README.md`
- `docs/CURRENT.md` — current-state orientation: what the repo is, what's active, what's archived
- `docs/MCP_CONTRACT.md` — desktop MCP tool contract, transport/auth posture, and result rules
- `docs/LINUX_MACOS_PARITY_AUDIT.md` — working checklist of macOS-vs-Linux native parity gaps
- `docs/ESP32_WIFI_REMOTE_ACCESS.md` — user-owned LAN/VPN remote access for ESP32 Wi-Fi
- `docs/ESP32_WIFI_TRANSPORT_AUDIT.md` — ESP32 Wi-Fi transport audit
- `docs/ESP32_WIFI_TRANSPORT_PLAN.md` — ESP32 Wi-Fi transport plan
- `docs/PLANNING.md` — durable working tracker for current priorities, active work, blockers, next steps
- `docs/SCHEDULE.md` — weekly planning/scheduling tracker
- `docs/TESTS.md` — active manual hardware test suite, test codes, and pass/pending tracking
- `docs/RELEASES.md` — release workflows, signing expectations, and public preview assets
- `docs/SIMULATOR.md` — shared device simulator for cross-platform testing
- `docs/parity/` — cross-platform feature parity contracts (MCP, transport, scripting, firmware, local-first)
- `docs/archive/` — archived docs from superseded implementation plans
- `videos/README.md` — video planning, direction, lightweight production rules, and writing guidance
- `.agents/skills/` — canonical EMWaver Codex skills for repo-local product guidance
- `.agents/skills/archive/` — archived skills for removed workflows
- `stm/README.md` — STM firmware workspace, protocol, runtime behavior, build/asset sync notes
- `esp/README.md` — ESP32 firmware workspace, transport/runtime direction, and internal build notes
- `arduino/README.md` — Arduino-compatible USB Serial firmware targets and Arduino CLI build/upload notes
- `../society/README.md` — Continual MI static site; EMWaver public pages live under `/emwaver`
- `hardware/README.md` — imported hardware design monorepo index and policy
- `windows/README.md` — Windows app pages/services/runtime map
- `apple/README.md` — shared Swift package (cross-platform Apple modules)
- `ios/README.md` — iOS app managers/views/assets
- `macos/README.md` — macOS app host/update/auth structure
- `android/README.md` — Android app transport/services/resources/assets

If a folder has a README, detailed documentation should live there.

---

## 5a) Script Engine & UI Rendering (cross-platform)

EMWaver scripts produce live UI via JSX. The `emw-ui` module provides
components (`Picker`, `Button`, `Card`, `Tile`, `Grid`, `Scroll`,
`TextField`, `TextEditor`, `LogViewer`, `Plot`, `Slider`, `Toggle`,
`Progress`, `Modal`, etc.) that are rendered natively on each platform:

| Platform | Script engine | UI renderer location |
| --- | --- | --- |
| **Windows** | ClearScript (V8) | `windows/EMWaver/Scripting/Render/ScriptRenderer.cs` |
| **Linux** | V8 / runtime crate | `linux/crates/emwaver-linux-runtime/` and `linux/crates/emwaver-linux-app/` |
| **macOS** | JavaScriptCore | `macos/EMWaver/EMWaver/Scripting/Render/` |
| **iOS** | JavaScriptCore | `ios/EMWaver/Scripting/Render/` |
| **Android** | V8 (J2V8) | `android/app/src/main/java/com/continualmi/emwaver/scripting/render/` |

**Key facts for agents working on UI/script issues:**

- `ScriptRenderer.cs` maps `ScriptNodeType` → WPF `UIElement` (e.g.,
  `ScriptNodeType.Picker` → `ComboBox`, `ScriptNodeType.Text` →
  `TextBlock`, `ScriptNodeType.Scroll` → `ScrollViewer`). This is the
  file to edit when a script UI component behaves wrong on Windows.
- Platform renderers follow the same node-type-to-native-control mapping
  pattern; look for the `RenderPicker`/`RenderButton`/etc. methods.
- The `ScriptNode` tree comes from the JSX transpiler
  (`ScriptSourceTranspiler.cs` on Windows) which converts `emw-jsx`
  JavaScript into a typed node tree.
- Default scripts ship in `assets/default-scripts/` and are bundled
  into each app's resources.
- Picker options are passed as `List<object>` dictionaries with
  `label`/`value` keys; the `selected` prop is a string matching the
  value.

---

## 6) Repo Overview (high level)

- `android/`, `ios/`, `macos/`, `windows/`, `linux/` — native client apps (self-contained, local-first).
- `apple/` — shared Swift package (cross-platform Apple modules).
- `stm/` — STM32 firmware and firmware-related tooling.
- `esp/` — ESP32 firmware workspace for autonomous and multi-transport board targets.
- `arduino/` — Arduino-compatible USB Serial firmware sketches for non-ESP Arduino boards.
- `firmware/` — bundled firmware payloads consumed by apps (per-board binaries).
- `crates/` — Rust crates (`emwaver-dfu`, `emwaver-dfu-helper`) for firmware flashing.
- `simulator/` — shared device simulator fixtures and protocol adapters for cross-platform testing.
- `hardware/` — imported hardware design repositories.
- `web/` — public static website and docs (exports to `web/out-emwaver`, deployed to `emwaver.ai`).
- `videos/` — video planning metadata, clip backlog, creative direction, and promo writing.
- `tools/` — ESP helper and other build tooling.
- `.agents/skills/` — EMWaver-specific Codex skills for repo-local product guidance.

---

## 7) Non-negotiable Platform Policies

1. **Managed transport architecture**: USB is first-class for host-backed boards, and the platform may also support BLE/Wi-Fi for board classes designed around them.
2. **Platform-managed runtime model**: heavy logic should live in host/apps or backend unless a supported autonomous board class explicitly owns that responsibility.
3. **Software-first business**: revenue comes from paid Continual model/API usage — not hardware sales, EMWaver accounts, hosted cloud control, or paid local device access.
4. **Local hardware access is free/open**: core local JavaScript execution must not require account sign-in, cloud activation, subscription checks, or hosted relay access.
5. **Local scripts stay local by default**: no required cloud script storage, cloud project sync, account-backed script library, or hosted file dependency in the core local flow.
6. **Script-first user experience**: avoid workflows that force end users through MCU toolchains.
7. **Platform-appropriate distribution**: desktop uses direct installers/downloads; mobile uses app stores, with Android APK available as an alternate path.
8. **Backend authority is inference-only**: do not put local core hardware access behind backend policy, device registration, subscription checks, or account state.
9. **No activation gate**: local board access is not governed by plan entitlements or hosted device ownership.
10. **Multi-board support**: the platform supports multiple MCU targets behind a unified UX.
11. **CI/Releases policy**: GitHub Actions are for platform CI and optional deployment; public static pages deploy from `../society`, and GitHub Releases are not end-user app distribution for apps.

---

## 8) Contribution Guardrails

- Prefer docs and code updates in the same PR when behavior changes.
- When changing a specific subsystem, update that folder's README.
- When porting or matching behavior from another supported platform, read the actual source implementation for the reference platform first, not just docs or summaries. Match the real architecture and user-visible behavior; do not invent platform-local shims, fake previews, substitute UI, or prototype-only approximations when a working implementation already exists elsewhere in the repo.
- Keep AGENTS concise; do not re-expand it with subsystem internals.
- Do not move secrets into repo docs.
- Keep local runtime work account-free and cloud-free. Desktop MCP must be local and user-controlled; any paid model/API integration stays outside the core hardware-control path.
- Keep imported hardware repos under `hardware/` and preserve history where practical.

Workflow:
- sync branch before work (`git pull --rebase`),
- make focused commits when a logical unit of work is complete,
- commit and push to `main` whenever new work is completed and verified,
- default end-of-task behavior is to run a compact validation/status check, commit the finished work, and push it to `main`,
- if full validation is not practical in-agent (for example Windows/Xcode/hardware-only checks), still commit and push the focused change with a clear validation note instead of leaving it unpushed,
- agents must not leave completed work unpushed unless the user explicitly says not to commit or push for that work.

## 9) Org Workspace

- The Continual MI organization workspace on this machine is rooted at `/Users/luisml/continualmi`.
- For shared Continual MI company context and a compact summary of every repo, read `../AGENTS.md`.
- Short version: Continual MI is an LLC founded by Luís Marnoto from Sintra, Portugal, focused on advancing machine intelligence and continual learning; EMWaver is the electronics/software product, `mdl` is the shared Monte Lua engine/platform and contains `montelua` plus `continual-core`, and `society` is the company site and community surface.
- Active organization repos are expected to be cloned inside that directory as `/Users/luisml/continualmi/emwaver`, `/Users/luisml/continualmi/society`, and `/Users/luisml/continualmi/mdl`.
- From this repository, the other active organization repos are available one directory up and down again as sibling paths such as `../society` and `../mdl`.
- Automation in this repo may inspect and modify files across those sibling repositories when a task requires coordinated cross-repo changes.
- Keep cross-repo edits intentional and update the relevant local docs in each touched repository.
