# EMWaver

EMWaver is a host-powered, AI-first electronics platform centered on USB MIDI SysEx hardware control and script-first workflows.

This root README is intentionally short. Detailed subsystem docs live in folder READMEs.

## Documentation Index

- `AGENTS.md` — repo-wide vision, non-negotiable platform policies, and contribution guardrails.
- `stm/README.md` — firmware architecture/protocol/build and firmware asset sync notes.
- `backend/README.md` — backend routes/auth/storage/websocket/provisioning/entitlements.
- `frontend/README.md` — website/web client architecture and backend integration contracts.
- `securewaver/README.md` — internal provisioning/minting/DFU flows.
- `daemon/README.md` — headless host daemon runtime and protocol behavior.
- `windows/README.md` — Windows app structure and service/page map.
- `apple/README.md` — shared Apple Swift package modules.
- `ios/README.md` — iOS app managers/views/assets.
- `macos/README.md` — macOS app host/update/auth structure.
- `android/README.md` — Android app transport/services/resources/assets.

## Repo Layout (high level)

- `stm/` — STM firmware workspace.
- `backend/` — cloud backend service.
- `frontend/` — website/web surfaces.
- `android/`, `ios/`, `macos/`, `windows/` — client apps.
- `apple/` — shared Apple package.
- `daemon/` — headless host runtime.
- `securewaver/` — internal provisioning tool.
- `firmware/` — bundled firmware payloads consumed by apps.
