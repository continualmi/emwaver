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

## 0) Agent Workflow

- Keep validation logs compact. `xcodebuild`, ESP-IDF, and other embedded build systems can emit very large logs that waste conversation context. Prefer quiet or filtered output by default, such as `xcodebuild -quiet ...`, `idf.py build 2>&1 | tail -120`, or focused `rg` filters for `error:`, `warning:`, and file paths. Only capture or paste full build logs when the compact output is insufficient to diagnose a failure.

---

## 1) Product Vision (core)

EMWaver is a **local-first**, open-source, AI-assisted electronics platform by **Continual MI**. It turns supported MCU boards into a scriptable hardware lab through local apps, managed firmware, and optional Agent assistance.

Core direction:
- **Business model:** open-source core plus paid Agent API usage. Revenue should come from the Agent service, not from accounts, hosted cloud control, or gating local hardware access.
- **No EMWaver accounts/cloud:** EMWaver itself should not require or maintain product accounts, cloud activation, hosted relay, cloud script storage, cloud sync, or subscription checks for core use.
- **Local-first core:** users should be able to run local JavaScript scripts without a Continual MI account, EMWaver account, cloud activation, hosted relay, or subscription check.
- **Local data ownership:** scripts and core local state should live on the user's device. Do not add cloud script storage, cloud script sync, or account-backed local project storage to the open-source core path.
- **Remote control posture:** native apps should not be positioned as Continual-hosted remote-control hosts for the open-source core. Native apps stay self-contained. Remote use should be user-owned SSH/VPN/Tailscale/port-forwarding around the local tool.
- **Transport:** managed multi-transport platform. USB remains first-class for host-backed boards; supported boards may also expose BLE and Wi-Fi when the platform/runtime design requires it.
- **Hardware:** multiple supported MCU boards (currently STM32-based, with ESP32 support returning; e.g., STM32F042 EMWaver board and ESP32-S3 class devices). Users bring their own compatible board.
- **Hardware repo direction:** EMWaver should become a single open-source monorepo, with imported hardware design repos preserved under `hardware/`.
- **Firmware:** per-board firmware targets managed by the platform. Users never build or flash firmware manually; apps should handle firmware setup and updates where practical.
- **UX:** script-first hardware exploration (instant run; no user build/flash loop).
- **AI:** Agent-assisted workflows are first-class and are the primary paid product direction. Each app may keep its own Agent interface/runtime, but those runtimes are API clients. The only planned network interface is an optional API key to a future Continual MI/MGPT Agent backend.
- **Client surfaces:** Android, iOS, macOS, Windows.
- **Distribution:** direct desktop installers/downloads for macOS and Windows; mobile store distribution for iOS and Android, with Android APK available as an alternate direct install path.

---

## 2) Platform Thesis

### The Core Thesis

1. **Local-first electronics platform** — EMWaver uses local apps as the default hardware-control path.
2. **Software-first platform** — the product is the software stack (apps, firmware, runtime, scripts, and Agent), not the hardware. Users supply their own supported MCU board.
3. **AI-first platform** — agents are first-class for building/testing scripts and interacting with runtime UI.
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
- Revenue through paid Agent API usage.
- Multiple supported boards, one unified UX.
- Cross-platform apps (Android/iOS/macOS/Windows).
- Agent-driven exploration loops.
- Larger addressable market (every compatible board owner).

---

## 3) Important Strategic Notes (high-level)

### Business model (open-source core + Agent API)

- **Open-source core**: local runtime, firmware payloads, scripts, and hardware support should be useful without payment or account sign-in.
- **Paid Agent API**: the EMWaver Agent is the primary paid product. It writes, debugs, explains, and improves local JavaScript scripts using server-side Continual MI/MGPT instructions and metered API usage.
- **No EMWaver cloud product**: do not plan accounts, hosted relay, sync, teams, classrooms, remote fleet behavior, or cloud dashboards as part of the EMWaver core. Any future network service belongs to the focused Continual MI/MGPT Agent backend unless a later product decision explicitly reopens cloud services.
- **No cloud script storage by default**: local scripts should be opened/saved from the user's filesystem or app-local storage. Do not build script sync as a default product assumption.
- **AI credits/usage**: Agent usage remains a metered resource.
- **Hardware is optional**: the EMWaver board is a future premium option ("coming soon"), not a launch dependency. Third-party supported boards are first-class.

### Device trust model

- Local hardware control must not be gated by backend activation or account ownership.
- EMWaver should move away from hardware-UID identity as a product requirement. Local control should work immediately without reading immutable board IDs for activation, minting, ownership, device limits, or gates.
- Do not introduce hosted device registration, device limits, device minting, or backend ownership checks for core EMWaver hardware control.
- Backend enforcement applies only to the paid Agent API, not to the open-source local core.

(Implementation details live in `macos/README.md`; public static web pages live in `../society` under `/emwaver`.)

### Supported boards

- The platform supports multiple MCU targets. Each target needs a firmware implementation of the transport/runtime model appropriate to that board class, plus platform identity and managed update support.
- Current/planned targets: STM32F042 (EMWaver board — coming soon) and ESP32-S3 class targets.
- Adding a new supported board = porting firmware + adding its binary to the app bundle.
- Users see a unified experience regardless of which board they use.

### Agent direction (model strategy)

- EMWaver product language should refer to the **Agent**, not to an EMWaver-specific model line.
- Near-term EMWaver AI is served by the Continual MI/MGPT backend rather than by prompts or inference logic shipped in this repo.
- Conversational chat and single-turn control operation are product modes of the Agent, not separate branded model categories.
- App-level Agent runtimes should collect local script/device/UI/error context and send it to the Agent API. They must not embed production system prompts, proprietary JavaScript instruction packs, hidden board recipes, provider-routing logic, or metering policy.
- EMWaver Agent clients must use the public/external Agent API surface, such as `/api/mgpt/...` on the configured public host. They must not call MDL-only `/backend-api/...` routes. Those routes are reserved for MDL's trusted internal integration path.
- Do not change MDL gameplay, MDL `backend-api` behavior, or MGPT internals merely to make an EMWaver Agent flow work. Treat public Agent API failures as public API contract issues unless the user explicitly asks for MGPT/MDL backend implementation work.

### Distribution and release posture

- Desktop distribution is direct-download first: macOS DMG and Windows installer EXE, with Windows ZIP kept as an alternate install path.
- Mobile distribution remains store-oriented: App Store for iPhone/iPad and Google Play for Android, with Android APK kept as an alternate direct install path.
- GitHub Releases may host preview downloadable artifacts; the public install page should present the user-facing paths clearly.

### Long-term hardware direction

- The EMWaver board may ship as a premium, purpose-built option when ready.
- Future hardware evolution (e.g., EMArm direction) should not fragment the multi-board platform UX.

### Strategic role inside Continual MI

- EMWaver is an important product surface, but it is not the company's primary benchmark for continual intelligence.
- MDL is currently the main mission vehicle for continual-learning evaluation and long-horizon product loops.
- EMWaver work should stay focused, launch-closing, and product-driven so it does not consume the bandwidth needed for MDL and MGPT progress.

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
- `docs/REBIRTH.md` — local-first/open-source rebirth plan and product pivot
- `docs/REBIRTH_ISSUES.md` — durable issue backlog for the rebirth plan
- `docs/REBIRTH_AUDIT.md` — completion audit and remaining gaps for the active rebirth objective
- `docs/LAUNCH_MVP.md` — minimum launch checklist for the local-first rebirth
- `docs/AGENT_API.md` — paid Agent API-key and endpoint direction
- `docs/AGENT_RUNTIME_AND_TOOLS.html` — visual Agent runtime/tooling document covering script authoring, native hardware tools, and local/API boundaries
- `docs/CROSS_PLATFORM_AGENT_UI_MIGRATION_PLAN.html` — cross-platform iOS, Android, macOS, and Windows migration plan for identical Agent/UI behavior, `.js`/`.jsx` authoring, and example/library/kernel separation
- `docs/ESP32_WIFI_REMOTE_ACCESS.md` — user-owned LAN/VPN/SSH remote access guidance for ESP32 Wi-Fi transport
- `docs/AGENT_EVAL_RUNTIME.md` — current Agent automation model: named hardware primitive tools (spi_transfer, gpio_read/write, analog_read); motivation for removing get_ui_snapshot/send_ui_event and eval
- `docs/UI_SNAPSHOT_RUNTIME_MIGRATION.md` — superseded; Gateway/CLI snapshot slice remains valid, native Agent snapshot/eval direction was reversed (see AGENT_EVAL_RUNTIME.md)
- `docs/TESTS_REBIRTH.md` — validation tracker for rebirth implementation work
- `docs/PLANNING.md` — durable working tracker for current priorities, active work, blockers, and next steps
- `docs/SCHEDULE.md` — active weekly planning/scheduling tracker used in ongoing execution updates
- `docs/TESTS.md` — active manual hardware test suite, test codes, and pass/pending tracking
- `videos/README.md` — video planning, direction, lightweight production rules, and writing guidance
- `.agents/skills/` — canonical EMWaver Codex skills for repo-local product guidance
- `stm/README.md` — STM firmware workspace, protocol, runtime behavior, build/asset sync notes
- `esp/README.md` — ESP32 firmware workspace, transport/runtime direction, and internal build notes
- `../society/README.md` — Continual MI static site; EMWaver public pages live under `/emwaver`
- `hardware/README.md` — imported hardware design monorepo index and policy
- `windows/README.md` — Windows app pages/services/runtime map
- `apple/README.md` — shared Swift package (cross-platform Apple modules)
- `ios/README.md` — iOS app managers/views/assets
- `macos/README.md` — macOS app host/update/auth structure
- `android/README.md` — Android app transport/services/resources/assets

If a folder has a README, detailed documentation should live there.

---

## 6) Repo Overview (high level)

- `stm/` — firmware and firmware-related tooling (multi-board targets).
- `esp/` — ESP32 firmware workspace for autonomous and multi-transport board targets.
- Public website/docs/downloads surface — owned by `../society` under `/emwaver`; this repo no longer carries a standalone `web/` app. Agent/API behavior should move to the focused Continual MI/MGPT backend instead of an EMWaver cloud runtime.
- `android/`, `ios/`, `macos/`, `windows/` — client apps.
- `apple/` — shared Apple code package.
- `firmware/` — bundled firmware payloads consumed by apps (per-board binaries).
- `videos/` — video planning metadata, clip backlog, creative direction, and promo writing.
- `hardware/` — target location for imported EMWaver hardware design repositories.
- `.agents/skills/` — EMWaver-specific Codex skills that now live with the product repo.

---

## 7) Non-negotiable Platform Policies

1. **Managed transport architecture**: USB is first-class for host-backed boards, and the platform may also support BLE/Wi-Fi for board classes designed around them.
2. **Platform-managed runtime model**: heavy logic should live in host/apps or backend unless a supported autonomous board class explicitly owns that responsibility.
3. **Software-first business**: revenue comes from paid Agent/API usage through Continual MI/MGPT — not hardware sales, EMWaver accounts, hosted cloud control, or paid local device access.
4. **Local hardware access is free/open**: core local JavaScript execution must not require account sign-in, cloud activation, subscription checks, or hosted relay access.
5. **Local scripts stay local by default**: no required cloud script storage, cloud project sync, account-backed script library, or hosted file dependency in the core local flow.
6. **Script-first user experience**: avoid workflows that force end users through MCU toolchains.
7. **Platform-appropriate distribution**: desktop uses direct installers/downloads; mobile uses app stores, with Android APK available as an alternate path.
8. **Backend authority is Agent-only**: do not put local core hardware access behind backend policy, device registration, subscription checks, or account state.
9. **No activation gate**: local board access is not governed by plan entitlements or hosted device ownership.
10. **Multi-board support**: the platform supports multiple MCU targets behind a unified UX.
11. **CI/Releases policy**: GitHub Actions are for platform CI and optional deployment; public static pages deploy from `../society`, and GitHub Releases are not end-user app distribution for apps.

---

## 8) Contribution Guardrails

- Prefer docs and code updates in the same PR when behavior changes.
- When changing a specific subsystem, update that folder's README.
- Keep AGENTS concise; do not re-expand it with subsystem internals.
- Do not move secrets into repo docs.
- Keep local runtime work account-free and cloud-free. The only planned network integration is the paid Agent API key flow to the future Continual MI/MGPT backend.
- Keep imported hardware repos under `hardware/` and preserve history where practical.

Workflow:
- sync branch before work (`git pull --rebase`),
- make focused commits when a logical unit of work is complete,
- commit and push to `main` whenever new work is completed and verified,
- agents must not leave completed verified work unpushed unless the user explicitly says not to commit or push for that work.

## 9) Org Workspace

- The Continual MI organization workspace on this machine is rooted at `/Users/luisml/continualmi`.
- For shared Continual MI company context and a compact summary of every repo, read `../AGENTS.md`.
- Short version: Continual MI is an LLC founded by Luís Marnoto from Sintra, Portugal, focused on advancing machine intelligence and continual learning; EMWaver is the electronics/software product, `mdl` is the shared Monte Lua engine/platform and contains `montelua`, `mgpt`, and `continual-core`, and `society` is the company site and community surface.
- Active organization repos are expected to be cloned inside that directory as `/Users/luisml/continualmi/emwaver`, `/Users/luisml/continualmi/society`, and `/Users/luisml/continualmi/mdl`.
- From this repository, the other active organization repos are available one directory up and down again as sibling paths such as `../society` and `../mdl`.
- Agents working in this repo may inspect and modify files across those sibling repositories when a task requires coordinated cross-repo changes.
- Keep cross-repo edits intentional and update the relevant local docs in each touched repository.
