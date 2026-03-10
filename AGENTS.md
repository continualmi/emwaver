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

## 1) Product Vision (core)

EMWaver is a **software-first**, host-powered, AI-first electronics platform by **Continual MI**. It turns phones/laptops/desktop hosts into a full hardware lab using supported MCU boards.

Core direction:
- **Business model:** software-first — revenue from paid device minting, platform services (Pro), and AI usage. No dependency on selling hardware to launch or operate.
- **Transport:** USB-only using class-compliant **USB MIDI SysEx** with fixed 64-byte frames.
- **Hardware:** multiple supported MCU boards (currently STM32-based; e.g., STM32F042 EMWaver board, STM32F103 BluePill). Users bring their own compatible board.
- **Firmware:** per-board firmware targets managed by the platform. Users never build or flash firmware manually — apps handle activation and updates.
- **UX:** script-first hardware exploration (instant run; no user build/flash loop).
- **AI:** agent-assisted workflows are first-class.
- **Client surfaces:** Android, iOS, macOS, Windows.
- **Distribution:** official app stores for end-user apps.

---

## 2) Platform Thesis

### The Core Thesis

1. **Host-powered electronics** — EMWaver uses the host (phone/laptop/desktop) for compute, UI, storage, and connectivity.
2. **Software-first platform** — the product is the software stack (apps, firmware, cloud, AI), not the hardware. Users supply their own supported MCU board.
3. **AI-first platform** — agents are first-class for building/testing scripts and interacting with runtime UI.
4. **Best beginner experience** — buy a cheap supported board, install the app, plug in, activate, and start exploring without firmware toolchains.

### Explicit Tradeoffs

We intentionally give up:
- dependency on hardware sales for revenue or launch,
- single-board hardware monopoly,
- on-device wireless-first UX,
- end-user firmware build/flash customization loops,
- "MCU toolchain as required user workflow."

### What We Gain

- Launch without hardware supply chain.
- Revenue from day one via minting + Pro + AI.
- Multiple supported boards, one unified UX.
- Cross-platform apps (Android/iOS/macOS/Windows).
- Cloud-connected remote workflows.
- Agent-driven exploration loops.
- Larger addressable market (every compatible board owner).

---

## 3) Important Strategic Notes (high-level)

### Business model (software-first)

- **Paid device minting**: users pay to activate (mint) a supported board as an EMWaver device. Minting is the entry point to the platform.
- **EMWaver Pro**: unlocks cloud-heavy capabilities and the full Agent experience. Backend-issued entitlements are authoritative.
- **AI credits/usage**: AI agent services are a revenue stream.
- **Hardware is optional**: the EMWaver board is a future premium option ("coming soon"), not a launch dependency. Third-party supported boards are first-class.

### Device trust model

- Minted devices receive `DeviceID + Proof` signed by root ed25519 key.
- Apps/backend verify proof against root public key.
- Unminted boards have no platform access — minting is the activation gate.
- Backend enforces minting policy, rate limits, and payment verification.

(Implementation details live in `macos/README.md` and `backend/README.md`.)

### Supported boards

- The platform supports multiple MCU targets. Each target needs a firmware implementation of the USB MIDI SysEx transport, identity page, and script runtime.
- Current/planned targets: STM32F042 (EMWaver board — coming soon), STM32F103 (BluePill).
- Adding a new supported board = porting firmware + adding its binary to the app bundle.
- Users see a unified experience regardless of which board they use.

### ELM direction (model strategy)

- EMWaver in-house model line is **ELM** (Electronics Language Models).
- LLM conversational mode and ELM control-turn mode are product-level complementary modes.

### Linux host scope

- Linux support is **headless host (beta)**, not a Linux GUI app.
- Remote controller surfaces render and control; host owns USB/runtime state.

### Distribution and release posture

- End-user app distribution is store-first (Apple App Store, Google Play, Microsoft Store).
- GitHub Releases are not the primary end-user app distribution channel.

### Long-term hardware direction

- The EMWaver board may ship as a premium, purpose-built option when ready.
- Future hardware evolution (e.g., EMArm direction) should not fragment the multi-board platform UX.

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

- `README.txt` (repo root) — concise repo overview + doc index
- `SCHEDULE.md` (repo root) — active weekly planning/scheduling tracker used in ongoing execution updates
- `TESTS.md` (repo root) — active manual hardware test suite, test codes, and pass/pending tracking
- `stm/README.md` — STM firmware workspace, protocol, runtime behavior, build/asset sync notes
- `backend/README.md` — backend architecture, routes, auth, storage, WS relay, provisioning APIs
- `frontend/README.md` — website/web client structure and backend contracts
- `daemon/README.md` — headless host daemon CLI/runtime/protocol behavior
- `windows/README.md` — Windows app pages/services/runtime map
- `apple/README.md` — shared Swift package (cross-platform Apple modules)
- `ios/README.md` — iOS app managers/views/assets
- `macos/README.md` — macOS app host/update/auth structure
- `android/README.md` — Android app transport/services/resources/assets

If a folder has a README, detailed documentation should live there.

---

## 6) Repo Overview (high level)

- `stm/` — firmware and firmware-related tooling (multi-board targets).
- `backend/` — cloud/backend services (minting, entitlements, AI, sync).
- `frontend/` — website/web surfaces.
- `android/`, `ios/`, `macos/`, `windows/` — client apps.
- `apple/` — shared Apple code package.
- `daemon/` — headless host runtime (beta scope).
- `firmware/` — bundled firmware payloads consumed by apps (per-board binaries).

---

## 7) Non-negotiable Platform Policies

1. **USB-first architecture**: core device comms are USB MIDI SysEx.
2. **Host-centric model**: heavy logic lives on host/apps, not on-device UX complexity.
3. **Software-first business**: revenue comes from minting, Pro, and AI — not hardware sales.
4. **Script-first user experience**: avoid workflows that force end users through MCU toolchains.
5. **Store distribution for end-user apps**: no alternative distribution as default product strategy.
6. **Backend is authoritative** for minting policy, cloud entitlements, and feature gating.
7. **Minting is the activation gate**: unminted boards get no platform/cloud access.
8. **Multi-board support**: the platform supports multiple MCU targets behind a unified UX.
9. **Linux host scope is headless/beta**: no Linux GUI app; remote-controller model only.
10. **CI/Releases policy**: GitHub Actions are for frontend/backend CI (and optional deployment); do not treat GitHub Releases as end-user distribution for apps.

---

## 8) Contribution Guardrails

- Prefer docs and code updates in the same PR when behavior changes.
- When changing a specific subsystem, update that folder's README.
- Keep AGENTS concise; do not re-expand it with subsystem internals.
- Do not move secrets into repo docs.

Workflow:
- sync branch before work (`git pull --rebase`),
- make focused commits,
- push changes after making updates (open PR branch if main push blocked).

## 9) Org Workspace

- The Continual MI organization workspace on this machine is rooted at `/Users/luisml/continualmi`.
- For shared Continual MI company context and a compact summary of every repo, read `../AGENTS.md`.
- Short version: Continual MI is an LLC founded by Luís Marnoto from Sintra, Portugal, focused on advancing machine intelligence and continual learning; EMWaver is the electronics/software product, Monte Lua (`mdl`) is the AI game SaaS, `imgpt` and `mgpt` are continual-operation model research, `cua` is an applied computer-use experiment, and `society` is the company site.
- Related organization repos are expected to be cloned inside that directory, for example `/Users/luisml/continualmi/emwaver`, `/Users/luisml/continualmi/society`, `/Users/luisml/continualmi/mdl`, `/Users/luisml/continualmi/imgpt`, `/Users/luisml/continualmi/mgpt`, and `/Users/luisml/continualmi/cua`.
- From this repository, the other organization repos are available one directory up and down again as sibling paths such as `../society`, `../mdl`, `../imgpt`, `../mgpt`, and `../cua`.
- Agents working in this repo may inspect and modify files across those sibling repositories when a task requires coordinated cross-repo changes.
- Keep cross-repo edits intentional and update the relevant local docs in each touched repository.
