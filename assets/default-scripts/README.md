# Default Script Assets

This folder is the canonical source for bundled EMWaver scripts:

- Android copies these into app bundles during build.
- Apple apps bundle matching default scripts in their targets.
- Native tooling and the Gateway both load from this folder path in repo workflows.

## Script runtime styles

Use this to reason about CLI behavior when UI is not visible.

### One-shot / command-response scripts

- `gpio.emw` (manual `HIGH`/`LOW` writes)
- `uart.emw` (open/close/read/write actions)
- `i2c.emw` (open/close/write/read/xfer/scan actions)
- `adc.emw` (read action)
- `pwm.emw` (apply/stop writes)
- `rfid.emw` (probe/scan/read/write blocks)

### UI-driven scripts (mostly event based)

- `chart.emw` (generate/reset/regenerate)
- `cc1101.emw` (initialize/read/edit/register edits/presets)
- `rfm69.emw` (profile actions and probe/RX/TX)
- `sampler.emw` (start/stop/retransmit/load/save/remove/clear)

### Continuous stream scripts

- `hello.emw` (periodic startup heartbeat logs)
- `blink.emw` (timer based output when running)

### Runtime helper

- `script_bootstrap.emw` (platform/runtime shim and API surface, not typically run as a user script)

## Shared CLI logging contract

All default scripts emit direct `console.log(...)` calls for terminal visibility.

Contract:

- startup context line per script:
  - script name + board/pin config + defaults
  - example: `[blink] startup | board=... pin=...`
- action/state lines:
  - start/transition/complete for user actions (start/stop, open/read/write, probe/init/reset, etc.)
  - keep short, stable keywords
- warnings/errors:
  - human-readable plain text
  - avoid stack-only or highly verbose payloads

For stream-like scripts, logs should be throttled to lifecycle/relevant milestones and avoid per-sample spam.
