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

EMWaver is a **software-first**, AI-first electronics platform by **Continual MI**. It turns supported MCU boards into a full hardware lab through EMWaver-managed host-backed and autonomous device flows.

Core direction:
- **Business model:** software-first SaaS — revenue comes from subscriptions for platform services plus AI usage/limits. No dependency on selling hardware to launch or operate.
- **Transport:** managed multi-transport platform. USB remains first-class for host-backed boards; supported boards may also expose BLE and Wi-Fi when the platform/runtime design requires it.
- **Hardware:** multiple supported MCU boards (currently STM32-based, with ESP32 support returning; e.g., STM32F042 EMWaver board and ESP32-S3 class devices). Users bring their own compatible board.
- **Firmware:** per-board firmware targets managed by the platform. Users never build or flash firmware manually — apps handle activation and updates.
- **UX:** script-first hardware exploration (instant run; no user build/flash loop).
- **AI:** agent-assisted workflows are first-class.
- **Client surfaces:** Android, iOS, macOS, Windows.
- **Distribution:** official app stores for end-user apps.

---

## 2) Platform Thesis

### The Core Thesis

1. **Managed electronics platform** — EMWaver uses host apps where that is the best fit, and supports autonomous board classes where direct cloud/device operation is the better product.
2. **Software-first platform** — the product is the software stack (apps, firmware, cloud, AI), not the hardware. Users supply their own supported MCU board.
3. **AI-first platform** — agents are first-class for building/testing scripts and interacting with runtime UI.
4. **Best beginner experience** — buy a cheap supported board, install the app, plug in, sign in, and start exploring without firmware toolchains.

### Explicit Tradeoffs

We intentionally give up:
- dependency on hardware sales for revenue or launch,
- single-board hardware monopoly,
- end-user firmware build/flash customization loops,
- "MCU toolchain as required user workflow."

### What We Gain

- Launch without hardware supply chain.
- Revenue from day one via subscriptions + AI.
- Multiple supported boards, one unified UX.
- Cross-platform apps (Android/iOS/macOS/Windows).
- Cloud-connected remote workflows.
- Agent-driven exploration loops.
- Larger addressable market (every compatible board owner).

---

## 3) Important Strategic Notes (high-level)

### Business model (software-first)

- **Subscription-first access**: users subscribe to EMWaver services rather than purchasing individual device activations.
- **Free tier**: may allow a small number of activated devices for local/basic use so onboarding remains low-friction.
- **Continual Pro**: is the shared Continual MI subscription and the authoritative paid entitlement for EMWaver. It unlocks the full cloud product, including remote hosting/control, sync, higher device limits, and the full Agent experience. Any older `EMWaver Pro` wording should be treated as transitional product copy, not the long-term billing/account model.
- **AI credits/usage**: agent usage remains a metered resource even when access is subscription-gated.
- **Hardware is optional**: the EMWaver board is a future premium option ("coming soon"), not a launch dependency. Third-party supported boards are first-class.

### Device trust model

- EMWaver V1 device registration is keyed by immutable per-board hardware UID (for example, STM32 unique ID registers or ESP32 factory chip identity/MAC-derived identifier) together with board type, so activation is tied to a physical board.
- Backend registration is authoritative for `board_type + hardware_uid`; re-flashing the same physical board should restore its existing EMWaver activation state rather than consume another device slot.
- Access is gated by account entitlements and device-count limits, not by per-device purchases.
- Backend enforces subscription policy, device limits, rate limits, and payment verification.

(Implementation details live in `macos/README.md` and `web/README.md`.)

### Supported boards

- The platform supports multiple MCU targets. Each target needs a firmware implementation of the transport/runtime model appropriate to that board class, plus platform identity and managed update support.
- Current/planned targets: STM32F042 (EMWaver board — coming soon) and ESP32-S3 class targets.
- Adding a new supported board = porting firmware + adding its binary to the app bundle.
- Users see a unified experience regardless of which board they use.

### Agent direction (model strategy)

- EMWaver product language should refer to the **Agent**, not to an EMWaver-specific model line.
- Near-term EMWaver AI is foundation-model-backed and product-managed rather than framed around a custom in-house model family.
- Conversational chat and single-turn control operation are product modes of the Agent, not separate branded model categories.

### Linux host scope

- Linux support is **headless host (beta)**, not a Linux GUI app.
- Remote controller surfaces render and control; host-backed boards keep runtime state on the host, while autonomous board classes may connect directly without a host.

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
- `PLANNING.md` (repo root) — durable working tracker for current priorities, active work, blockers, and next steps
- `SCHEDULE.md` (repo root) — active weekly planning/scheduling tracker used in ongoing execution updates
- `TESTS.md` (repo root) — active manual hardware test suite, test codes, and pass/pending tracking
- `videos/README.md` — video planning, direction, lightweight production rules, and writing guidance
- `stm/README.md` — STM firmware workspace, protocol, runtime behavior, build/asset sync notes
- `esp/README.md` — ESP32 firmware workspace, transport/runtime direction, and internal build notes
- `web/README.md` — unified Next.js + Node web app and TypeScript backend
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
- `esp/` — ESP32 firmware workspace for autonomous and multi-transport board targets.
- `web/` — unified website/web app target (Next.js + Node, single deployment direction).
- `android/`, `ios/`, `macos/`, `windows/` — client apps.
- `apple/` — shared Apple code package.
- `daemon/` — headless host runtime (beta scope).
- `firmware/` — bundled firmware payloads consumed by apps (per-board binaries).
- `videos/` — video planning metadata, clip backlog, creative direction, and promo writing.

---

## 7) Non-negotiable Platform Policies

1. **Managed transport architecture**: USB is first-class for host-backed boards, and the platform may also support BLE/Wi-Fi for board classes designed around them.
2. **Platform-managed runtime model**: heavy logic should live in host/apps or backend unless a supported autonomous board class explicitly owns that responsibility.
3. **Software-first business**: revenue comes from subscriptions and AI — not hardware sales.
4. **Script-first user experience**: avoid workflows that force end users through MCU toolchains.
5. **Store distribution for end-user apps**: no alternative distribution as default product strategy.
6. **Backend is authoritative** for subscription policy, device limits, cloud entitlements, and feature gating.
7. **Activation is account-gated**: device access is governed by plan entitlements and allowed device counts, not individual device purchases.
8. **Multi-board support**: the platform supports multiple MCU targets behind a unified UX.
9. **Linux host scope is headless/beta**: no Linux GUI app; remote-controller model only.
10. **CI/Releases policy**: GitHub Actions are for web CI (and optional deployment); do not treat GitHub Releases as end-user distribution for apps.

---

## 8) Contribution Guardrails

- Prefer docs and code updates in the same PR when behavior changes.
- When changing a specific subsystem, update that folder's README.
- Keep AGENTS concise; do not re-expand it with subsystem internals.
- Do not move secrets into repo docs.

Workflow:
- sync branch before work (`git pull --rebase`),
- make focused commits when a logical unit of work is complete,
- ask before committing unless the user explicitly requested it.

## 9) Org Workspace

- The Continual MI organization workspace on this machine is rooted at `/Users/luisml/continualmi`.
- For shared Continual MI company context and a compact summary of every repo, read `../AGENTS.md`.
- Short version: Continual MI is an LLC founded by Luís Marnoto from Sintra, Portugal, focused on advancing machine intelligence and continual learning; EMWaver is the electronics/software product, `mdl` is the shared Monte Lua engine/platform, `montelua` is the extracted Monte Lua game package, `mgpt` is the continual-operation model research repo, `society` is the company site and community surface, and `continual-core` is the shared non-deployed contract package for the `core` schema.
- Related organization repos are expected to be cloned inside that directory, for example `/Users/luisml/continualmi/emwaver`, `/Users/luisml/continualmi/emwaver-shield`, `/Users/luisml/continualmi/society`, `/Users/luisml/continualmi/mdl`, `/Users/luisml/continualmi/montelua`, and `/Users/luisml/continualmi/mgpt`.
- From this repository, the other organization repos are available one directory up and down again as sibling paths such as `../emwaver-shield`, `../society`, `../mdl`, `../montelua`, and `../mgpt`.
- Agents working in this repo may inspect and modify files across those sibling repositories when a task requires coordinated cross-repo changes.
- Keep cross-repo edits intentional and update the relevant local docs in each touched repository.
