---
title: Development Setup
---

# Development Setup

This page covers the common local workflows for hacking on EMWaver.

## Docs

From `docs/`:

```bash
python -m mkdocs serve -f docs/mkdocs.yml
```

If you only want a static build:

```bash
python -m mkdocs build -f docs/mkdocs.yml
```

## CLI

From `cli/`:

```bash
cargo build
cargo test
```

## Desktop App

The desktop app is a Tauri project under `app/` (Vite + Rust).

## Android / iOS

- Android lives under `android/`.
- iOS lives under `ios/`.

## Optional: Dev Orchestration Helpers

This repo includes tmux helpers under `skills/environment/scripts/` to bring up common panes for docs, firmware, CLI, etc.
They’re optional—use them if they match your workflow.

