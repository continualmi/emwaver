# App Overview

The EMWaver applications guide every interaction with the device—from pairing and diagnostics to capturing signals and managing wavelets. This overview surfaces each fragment, the functionality it exposes, and where upcoming screenshots will live.

## Fragment Guide

### Home Fragment

- Connect to nearby EMWaver devices, manage BLE pairing, and surface connection health.
- Pin recent captures, favorite wavelets, and onboarding tips for quick access.
- Surface device telemetry (battery, firmware version, connection quality) in a compact status panel.

![Home fragment screenshot placeholder](https://placehold.co/1200x650?text=Home+Fragment)

### ISM Fragment

- Inspect sub-GHz configuration, including frequency plans, modulation schemes, and transmit power.
- Toggle presets tailored for region-specific regulations and experimental profiles.
- Queue hardware actions like listen-before-talk scanning or spectrum sweeps.

![ISM fragment screenshot placeholder](https://placehold.co/1200x650?text=ISM+Fragment)

### Sampler Fragment

- Capture RF signals with timestamped metadata and waveform visualization.
- Annotate samples before saving.
- Promote recordings into reusable assets for wavelets or direct playback from the device.

![Sampler fragment screenshot placeholder](https://placehold.co/1200x650?text=Sampler+Fragment)

### Wavelets Fragment

- Browse, edit, and sync JavaScript bundles that render UI with the EMWaver DSL.
- Run scripts with live console output and integrate `UI.logViewer` panes for inline diagnostics.
- Manage wavelet repositories through Git sync.

![Wavelets fragment screenshot placeholder](https://placehold.co/1200x650?text=Wavelets+Fragment)

### Git Fragment

- Configure GitHub repository + personal access token.
- Clone/pull wavelet assets from a repo.
- Push local changes back to GitHub with status indicators and conflict resolution.

![Git fragment screenshot placeholder](https://placehold.co/1200x650?text=Git+Fragment)

## Wavelet Console Integration

- The Wavelets fragment surfaces runtime logs next to the editor for in-wavelet debugging.
- Console history persists with each bundle revision, making it easy to share context during collaboration.

## Quick Reference

| Fragment | Highlights |
| --- | --- |
| Home | Device pairing, live status, quick actions |
| ISM | Sub-GHz presets, modulation configuration, compliance helpers |
| Sampler | RF capture, waveform visualization |
| Wavelets | Script editor, console integration |
| Git | GitHub repo sync, clone/pull/push workflows |
