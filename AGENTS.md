# EMWaver Repository Guidelines

This file is intentionally concise, but it must preserve EMWaver’s core vision and strategic product direction.

`AGENTS.md` is the repo-wide source of truth for:
- product vision,
- non-negotiable platform decisions,
- high-level business/platform strategy,
- documentation routing (which folder README to use),
- contribution guardrails.

Implementation details belong in folder-level `README.md` files.

---

## 1) Product Vision (core)

EMWaver is a host-powered, AI-first electronics platform that turns phones/laptops/desktop hosts into a full hardware lab.

Core direction:
- **Transport:** USB-only using class-compliant **USB MIDI SysEx** with fixed 64-byte frames.
- **Hardware:** one primary **STM32** device line (currently STM32F042-based board).
- **Firmware:** one user-facing firmware track (no public board matrix/variants UX).
- **UX:** script-first hardware exploration (instant run; no user build/flash loop).
- **AI:** agent-assisted workflows are first-class.
- **Client surfaces:** Android, iOS, macOS, Windows.
- **Distribution:** official app stores for end-user apps.

---

## 2) Platform Thesis

### The Core Thesis

1. **Host-powered electronics** — EMWaver uses the host (phone/laptop/desktop) for compute, UI, storage, and connectivity.
2. **AI-first platform** — agents are first-class for building/testing scripts and interacting with runtime UI.
3. **Best beginner experience** — plug in and start exploring without firmware toolchains.

### Explicit Tradeoffs

We intentionally give up:
- on-device wireless-first UX,
- end-user firmware build/flash customization loops,
- “MCU toolchain as required user workflow.”

### What We Gain

- One board / one firmware track.
- Cross-platform apps (Android/iOS/macOS/Windows).
- Cloud-connected remote workflows.
- Agent-driven exploration loops.

---

## 3) Important Strategic Notes (high-level)

### Hardware authenticity (anti-clone posture)

- Genuine-device verification uses `DeviceID + Proof` anchored in a root-key trust model.
- Official apps/backend verify authenticity; backend enforces cloud policy.
- Cloud features/Pro are designed around verified genuine hardware.

(Implementation details live in `securewaver/README.md` and `backend/README.md`.)

### EMWaver Pro (business model direction)

- **EMWaver Pro** unlocks cloud-heavy capabilities and the full Agent experience.
- Backend-issued entitlements are authoritative for Pro/cloud feature access.

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

- Keep room for future hardware evolution (e.g., EMArm direction) without fragmenting current one-device product UX.

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
- `stm/README.md` — STM firmware workspace, protocol, runtime behavior, build/asset sync notes
- `backend/README.md` — backend architecture, routes, auth, storage, WS relay, provisioning APIs
- `frontend/README.md` — website/web client structure and backend contracts
- `securewaver/README.md` — internal provisioning/minting/DFU tool
- `daemon/README.md` — headless host daemon CLI/runtime/protocol behavior
- `windows/README.md` — Windows app pages/services/runtime map
- `apple/README.md` — shared Swift package (cross-platform Apple modules)
- `ios/README.md` — iOS app managers/views/assets
- `macos/README.md` — macOS app host/update/auth structure
- `android/README.md` — Android app transport/services/resources/assets

If a folder has a README, detailed documentation should live there.

---

## 6) Repo Overview (high level)

- `stm/` — firmware and firmware-related tooling.
- `backend/` — cloud/backend services.
- `frontend/` — website/web surfaces.
- `android/`, `ios/`, `macos/`, `windows/` — client apps.
- `apple/` — shared Apple code package.
- `daemon/` — headless host runtime (beta scope).
- `securewaver/` — internal manufacturing/provisioning tool (not end-user app).
- `firmware/` — bundled firmware payloads consumed by apps.

---

## 7) Non-negotiable Platform Policies

1. **USB-first architecture**: core device comms are USB MIDI SysEx.
2. **Host-centric model**: heavy logic lives on host/apps, not on-device UX complexity.
3. **Script-first user experience**: avoid workflows that force end users through MCU toolchains.
4. **Store distribution for end-user apps**: no alternative distribution as default product strategy.
5. **Backend is authoritative** for cloud entitlements/feature gating.
6. **Provisioning/minting flows are internal-only** (SecureWaver/manufacturing scope).
7. **Linux host scope is headless/beta**: no Linux GUI app; remote-controller model only.
8. **CI/Releases policy**: GitHub Actions are for frontend/backend CI (and optional deployment); do not treat GitHub Releases as end-user distribution for apps.

---

## 8) Contribution Guardrails

- Prefer docs and code updates in the same PR when behavior changes.
- When changing a specific subsystem, update that folder’s README.
- Keep AGENTS concise; do not re-expand it with subsystem internals.
- Do not move secrets into repo docs.

Workflow:
- sync branch before work (`git pull --rebase`),
- make focused commits,
- push changes after making updates (open PR branch if main push blocked).
