# App Overview

The EMWaver application guides every interaction with the device—from pairing and diagnostics to capturing signals, managing scripts, and collaborating with the built-in agent. This overview surfaces each fragment, the functionality it exposes, and where upcoming screenshots will live.

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
- Share bundles through backend storage so every device stays in sync.

![Wavelets fragment screenshot placeholder](https://placehold.co/1200x650?text=Wavelets+Fragment)

### Agents Fragment

- Chat with the EMWaver LLM agent for clarification on hardware behavior, application workflows, or documentation references.
- Request help generating or debugging wavelet scripts—the agent reads console output and suggests targeted fixes.
- Trigger context-aware guidance, such as reviewing sampler traces or debugging signal captures.

![Agents fragment screenshot placeholder](https://placehold.co/1200x650?text=Agents+Fragment)

## Wavelet Console Integration

- The Wavelets fragment surfaces runtime logs next to the editor and mirrors them to the Agents fragment for collaborative debugging.
- Console history persists with each bundle revision, making it easy to share context when requesting agent assistance or collaborating with teammates.

## Quick Reference

| Fragment | Highlights |
| --- | --- |
| Home | Device pairing, live status, quick actions |
| ISM | Sub-GHz presets, modulation configuration, compliance helpers |
| Sampler | RF capture, waveform visualization |
| Wavelets | Script editor, console integration |
| Agents | LLM assistance, wavelet debugging, contextual guidance |