# Script Asset Scripts (Canonical)

This folder is the single source of truth for EMWaver’s built-in Script assets (`.emw`).

- Android sync/copies these files into the app bundle during build.
- Apple apps (iOS/macOS) bundle their default scripts in their app projects; keep them aligned with this directory.

## Minimal example

- `hello.emw`: minimal script that just `print()`s.
- `blink.emw`: blinks `GDO0` using `every()` and `print()` with a tiny UI.
