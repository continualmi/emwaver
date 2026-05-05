EMWaver monorepo — a Continual MI project
Local-first, open-source hardware scripting platform with optional paid Agent API usage.
License: Apache-2.0 (see `LICENSE`).
Rebirth plan: `REBIRTH.md`
Durable rebirth issue backlog: `REBIRTH_ISSUES.md`
Rebirth completion audit: `REBIRTH_AUDIT.md`
Launch MVP checklist: `LAUNCH_MVP.md`
Agent API direction: `AGENT_API.md` — app-level Agent interfaces stay, but inference goes through a user API key to the future Continual MI/MGPT backend; production prompts/instructions do not belong in this open-source repo.
Packaging direction: `PACKAGING.md`
Rebirth validation tracker: `TESTS_REBIRTH.md`
Shared mock device simulator goal: `SIMULATOR.md`
Virtual simulator transport decision: `simulator/VIRTUAL_TRANSPORT.md`
Rust preflight: `scripts/check-rust-toolchain.sh`
Rebirth hardware validation helper: `scripts/rebirth-hardware-validation.sh`
Linux rebirth validation runbook: `scripts/rebirth-linux-validation.sh`
Windows rebirth validation runbook: `scripts/rebirth-windows-validation.ps1`
Current planning tracker: `PLANNING.md`
Web direction: public EMWaver static pages now live in `../society` under `/emwaver`; this repo no longer carries a standalone `web/` app. Localhost script control lives in `gateway/`.
Current headless CLI/daemon work: `daemon/`
Hardware monorepo: the nine primary hardware repos now live under flat `hardware/<repo-name>/` paths; board/module media assets should be canonical there and reused by docs/static surfaces instead of duplicated.
Hardware asset dedup inventory: `hardware/ASSET_DEDUP_INVENTORY.md`
All repo-wide product constraints and documentation routing live in `AGENTS.md`.
Ask Codex/Claude Code "how does emwaver work" to get started
