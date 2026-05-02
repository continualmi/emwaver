# EMWaver Hardware

This folder is the target home for EMWaver hardware design repositories in the reborn open-source monorepo.

Hardware imports should preserve git history where practical and land under stable prefixes:

```text
hardware/
  boards/
  modules/
```

## Boards

Boards are complete or primary EMWaver-compatible hardware targets.

Planned prefixes:

```text
hardware/boards/emwaver-air/
hardware/boards/emwaver-carrier/
hardware/boards/emwaver-core/
hardware/boards/emwaver-link/
hardware/boards/emwaver-shield/
```

## Modules

Modules are attachable/specialized hardware blocks used by EMWaver scripts and board setups.

Planned prefixes:

```text
hardware/modules/gpio-waver/
hardware/modules/infrared-waver/
hardware/modules/ism-waver/
hardware/modules/rfid-waver/
```

## Import Policy

- Preserve useful git history with `git subtree`, `git filter-repo`, or an equivalent history-preserving import.
- Keep imported hardware repos under `hardware/`; do not add imported files to the repo root.
- Keep app/runtime/platform source in the existing platform folders.
- Keep bundled app-consumed firmware payloads under `firmware/`.
- Keep manufacturing and board-specific documentation inside each hardware subfolder.
- Curate large generated manufacturing outputs carefully.
- Use Git LFS only if large binary assets become unavoidable.

## Current Status

No hardware repositories have been imported here yet.

See `hardware/IMPORT_INVENTORY.md` for the current source inventory and target prefix map.

## Import Script

`hardware/import-subtrees.sh` contains the repeatable history-preserving import commands.

The script refuses to run in a dirty worktree because `git subtree add` creates merge commits.

Trial import:

```bash
./hardware/import-subtrees.sh gpio-waver
```

Full import:

```bash
./hardware/import-subtrees.sh all
```
