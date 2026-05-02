EMWaver monorepo — a Continual MI project
Local-first, open-source hardware scripting platform with optional paid Agent services.
Rebirth plan: `REBIRTH.md`
Durable rebirth issue backlog: `REBIRTH_ISSUES.md`
Rebirth completion audit: `REBIRTH_AUDIT.md`
Launch MVP checklist: `LAUNCH_MVP.md`
Agent API direction: `AGENT_API.md`
Packaging direction: `PACKAGING.md`
Rebirth validation tracker: `TESTS_REBIRTH.md`
Shared mock device simulator goal: `SIMULATOR.md`
Virtual simulator transport decision: `simulator/VIRTUAL_TRANSPORT.md`
Rust preflight: `scripts/check-rust-toolchain.sh`
Rebirth hardware validation helper: `scripts/rebirth-hardware-validation.sh`
Linux rebirth validation runbook: `scripts/rebirth-linux-validation.sh`
Windows rebirth validation runbook: `scripts/rebirth-windows-validation.ps1`
Current planning tracker: `PLANNING.md`
Web direction: `web/` should trend toward static public pages/docs/downloads/board managers deployed from blob/static website hosting; auth/cloud dashboard/backend code is migration debt, and localhost script control lives in `gateway/`.
Web static migration inventory: `web/STATIC_MIGRATION_INVENTORY.md`
Current headless CLI/daemon work: `daemon/`
Hardware monorepo: the nine primary hardware repos now live under flat `hardware/<repo-name>/` paths; board/module media assets should be canonical there and reused by web/docs instead of duplicated.
Hardware asset dedup inventory: `hardware/ASSET_DEDUP_INVENTORY.md`
All repo-wide product constraints and documentation routing live in `AGENTS.md`.
Ask Codex/Claude Code "how does emwaver work" to get started
