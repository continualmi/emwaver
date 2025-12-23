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

This repo keeps each environment self-contained; use the build/run instructions in each subproject (`docs/`, `esp/`, `stm/`, `cli/`, `android/`, `ios/`, `app/`).
They’re optional—use them if they match your workflow.
