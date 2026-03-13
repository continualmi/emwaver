# EMWaver Shield Repository Guidelines

This repository is the hardware-facing home for **EMWaver Shield**.

Keep this file short and policy-oriented. Detailed notes belong in folder `README.md` files.

## Purpose

- Public/private hardware repo for the EMWaver Shield board.
- Primary contents: PCB design files, manufacturing outputs, board notes, images, and hardware documentation.
- This repo is not the source of truth for EMWaver software or internal firmware source.

## Keep in `AGENTS.md`

- Repo purpose and scope.
- Non-negotiable contribution guardrails.
- Documentation routing.

## Keep in folder `README.md`

- Board revision notes.
- CAD/EDA file structure.
- Manufacturing/export instructions.
- Assembly notes.
- Asset-specific guidance.

## Documentation map

- `README.md` - top-level board overview and repo positioning.
- `hardware/README.md` - PCB files, manufacturing exports, and revision layout.
- `docs/README.md` - board-facing documentation and assembly/user notes.

## Guardrails

- Do not add private EMWaver app, backend, or provisioning code here.
- Do not add internal firmware source unless that decision is explicitly changed later.
- If binaries are published, treat them as convenience artifacts, not the primary distribution channel.
- Prefer revision folders over creating a new repo for every small board iteration.
- Keep hardware docs and hardware assets updated together.

## Workspace note

- The Continual MI org workspace on this machine is rooted at `/Users/luisml/continualmi`.
- The main EMWaver product repo lives at `/Users/luisml/continualmi/emwaver`.
- Cross-repo edits should stay intentional and preserve the boundary between public hardware material and private product software.
