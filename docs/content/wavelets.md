---
title: Wavelets
---

# Wavelets

Wavelets are JavaScript bundles that let you orchestrate the EMWaver hardware without modifying firmware or shipping bespoke mobile builds. They expose a high-level API that mirrors the device capabilities—Sub-GHz RF, GPIO, storage, and logging—while remaining portable across the mobile app, CLI, and future surfaces.

## Goals and Motivation

- **Hardware access without flashing** – author custom behaviors that run on top of the stock firmware.
- **Rapid iteration** – save, sync, and test scripts directly from the app or CLI with hot reload-style feedback.
- **Shareable experiences** – distribute bundles to other EMWaver owners without requiring Xcode or Android Studio.
- **UI parity** – render identical interfaces across platforms through the shared DSL renderer.

Wavelets keep the core EMWaver application closed and stable while still giving makers deep customization. You can tailor workflows, dashboards, and signal utilities in days instead of maintaining forks of the native apps.

## Working with Wavelets

1. Open the **Wavelets** fragment in the app to browse local bundles and cloud-synced scripts.
2. Create or edit a script using the built-in editor, which includes syntax highlighting, console output, and integration with the EMWaver DSL renderer.
3. Deploy updates instantly—the runtime pulls new builds from storage and restarts the wavelet session on demand.
4. Use the **Agents** fragment to chat with the EMWaver assistant for debugging tips, coding guidance, or walkthroughs of existing scripts.

The runtime surfaces `UI.logViewer` output alongside agent responses so you can inspect execution traces, warnings, and custom diagnostics while iterating.

## Sharing and Collaboration

- Store wavelets in the backend to sync across devices.
- Distribute bundles alongside hardware projects so other users can replicate your setup.
- Use the CLI to clone, diff, and manage versions when collaborating with teammates.

Future updates will expand the capability registry, hot reload pipeline, and sandboxed storage so wavelets can orchestrate even richer device workflows.
