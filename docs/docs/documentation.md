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

- Capture RF and IR signals with timestamped metadata and waveform visualization.
- Decode infrared payloads via IRP, preview carrier settings, and annotate samples before saving.
- Promote recordings into reusable assets for wavelets or direct playback from the device.

![Sampler fragment screenshot placeholder](https://placehold.co/1200x650?text=Sampler+Fragment)

### Wavelets Fragment

- Browse, edit, and sync JavaScript bundles that render UI with the EMWaver DSL.
- Run scripts with live console output and integrate `UI.logViewer` panes for inline diagnostics.
- Import remotes from IRDB to auto-generate button layouts; each button binds to the correct IR payload instantly.
- Share bundles through backend storage so every device stays in sync.

![Wavelets fragment screenshot placeholder](https://placehold.co/1200x650?text=Wavelets+Fragment)

### Agents Fragment

- Chat with the EMWaver LLM agent for clarification on hardware behavior, application workflows, or documentation references.
- Request help generating or debugging wavelet scripts—the agent reads console output and suggests targeted fixes.
- Trigger context-aware guidance, such as explaining IRP decode results or reviewing sampler traces.

![Agents fragment screenshot placeholder](https://placehold.co/1200x650?text=Agents+Fragment)

## IRDB Contributions

When an infrared remote profile is missing, capture it within the Sampler fragment and submit it to the Infrared Database by opening an issue on the IRDB GitHub repository. Follow their submission checklist so the waveform data is validated quickly. Once merged, you can re-import the profile and immediately expose the full button layout through the Wavelets fragment.

## Wavelet Console Integration

- The Wavelets fragment surfaces runtime logs next to the editor and mirrors them to the Agents fragment for collaborative debugging.
- Console history persists with each bundle revision, making it easy to share context when requesting agent assistance or collaborating with teammates.

## Quick Reference

| Fragment | Highlights |
| --- | --- |
| Home | Device pairing, live status, quick actions |
| ISM | Sub-GHz presets, modulation configuration, compliance helpers |
| Sampler | RF/IR capture, IRP decoding, waveform visualization |
| Wavelets | Script editor, IRDB imports, console integration |
| Agents | LLM assistance, wavelet debugging, contextual guidance |