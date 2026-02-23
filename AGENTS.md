# EMWaver Repository Guidelines

This file is intentionally short.

`AGENTS.md` is the repo-wide source of truth for:
- product vision,
- non-negotiable platform decisions,
- documentation routing (which folder README to use),
- contribution guardrails.

Implementation details belong in folder-level `README.md` files.

---

## 1) Product Vision (core only)

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

## 2) What stays in AGENTS vs README

## Keep in `AGENTS.md`
- Vision and long-term direction.
- Hard platform constraints and policy-level decisions.
- Repo-wide guardrails.
- Folder documentation map.

## Move to folder `README.md`
- Architecture internals.
- File/class breakdowns.
- Protocol/opcode specifics.
- Build/run/test instructions.
- Platform-specific flows.
- Troubleshooting and implementation caveats.

---

## 3) Documentation Map (authoritative)

Use the local README first when working in a folder:

- `README.md` (repo root) — cross-cutting product/business/platform notes migrated out of historical AGENTS details
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

## 4) Repo Overview (high level)

- `stm/` — firmware and firmware-related tooling.
- `backend/` — cloud/backend services.
- `frontend/` — website/web surfaces.
- `android/`, `ios/`, `macos/`, `windows/` — client apps.
- `apple/` — shared Apple code package.
- `daemon/` — headless host runtime (beta scope).
- `securewaver/` — internal manufacturing/provisioning tool (not end-user app).
- `firmware/` — bundled firmware payloads consumed by apps.

---

## 5) Non-negotiable Platform Policies

1. **USB-first architecture**: core device comms are USB MIDI SysEx.
2. **Host-centric model**: heavy logic lives on host/apps, not on-device UX complexity.
3. **Script-first user experience**: avoid workflows that force end users through MCU toolchains.
4. **Store distribution for end-user apps**: no alternative distribution as default product strategy.
5. **Backend is authoritative** for cloud entitlements/feature gating.
6. **Provisioning/minting flows are internal-only** (SecureWaver/manufacturing scope).

---

## 6) Contribution Guardrails

- Prefer docs and code updates in the same PR when behavior changes.
- When changing a specific subsystem, update that folder’s README.
- Keep AGENTS concise; do not re-expand it with subsystem internals.
- Do not move secrets into repo docs.

Workflow:
- sync branch before work (`git pull --rebase`),
- make focused commits,
- push changes (open PR branch if main push blocked).

---

## 7) Documentation Maintenance Rule (important)

When details are added to `AGENTS.md` by accident:
1. move those details into the appropriate folder README,
2. keep only a short summary/pointer in `AGENTS.md`.

Target state: `AGENTS.md` stays short; folder READMEs hold depth.
