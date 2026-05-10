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

### Continuous UI scripts

- `hello.emw` (periodic heartbeat UI state)
- `blink.emw` (timer based output when running)

### Runtime helper

- `script_bootstrap.emw` (platform/runtime shim and API surface, not typically run as a user script)

## UI snapshot contract

Default scripts are UI programs. Visible state for CLI, browser, native app, and
Agent workflows must be rendered through `UI.render(...)` and read through
`ui.snapshot`.

Contract:

- startup context is visible in the rendered UI:
  - script name, board/module config, selected pins, and defaults,
- action state is visible in the rendered UI:
  - start/transition/complete states for user actions such as start/stop,
    open/read/write, probe/init/reset, save/load, and scan,
- warnings/errors are visible in the rendered UI:
  - human-readable status text,
  - enough detail for an Agent to diagnose the next step from a snapshot.

Do not add terminal logging as a parallel script contract. The migration in
`../../docs/UI_SNAPSHOT_RUNTIME_MIGRATION.md` removes script-visible
`console.*` APIs and relies on snapshots/events for terminal automation.
