# EMWaver Hardware

This folder is the target home for EMWaver hardware design repositories in the reborn open-source monorepo.

Hardware imports should preserve git history where practical and land under stable flat prefixes:

```text
hardware/
  emwaver-air/
  emwaver-carrier/
  emwaver-core/
  emwaver-link/
  emwaver-shield/
  gpio-waver/
  infrared-waver/
  ism-waver/
  rfid-waver/
```

## Layout

Each imported hardware repository keeps its original repo name directly under `hardware/`. Do not add extra `boards/`, `modules/`, or other grouping folders above the imported repos.

## Import Policy

- Preserve useful git history with `git subtree`, `git filter-repo`, or an equivalent history-preserving import.
- Keep imported hardware repos under `hardware/`; do not add imported files to the repo root.
- Keep app/runtime/platform source in the existing platform folders.
- Keep bundled app-consumed firmware payloads under `firmware/`.
- Keep manufacturing and board-specific documentation inside each hardware subfolder.
- Curate large generated manufacturing outputs carefully.
- Use Git LFS only if large binary assets become unavoidable.

## Current Status

The nine primary hardware repositories are imported with history preserved:

```text
hardware/emwaver-air/
hardware/emwaver-carrier/
hardware/emwaver-core/
hardware/emwaver-link/
hardware/emwaver-shield/
hardware/gpio-waver/
hardware/infrared-waver/
hardware/ism-waver/
hardware/rfid-waver/
```

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
