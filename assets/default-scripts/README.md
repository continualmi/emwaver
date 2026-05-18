# Default Script Assets

This folder is the canonical source for bundled EMWaver scripts:

- macOS now bundles the `.js` scripts and visible `emw-*` libraries from this folder.
- Android still needs a matching runtime migration; the canonical default assets are no longer `.emw`.
- Native tooling and the Gateway both load from this folder path in repo workflows.

The target public source format is JavaScript. Keep new macOS examples and
libraries as `.js` files with extensionless imports such as `import { pin, gpio }
from "emw-gpio";`.

## Script runtime styles

Use this to reason about CLI behavior when UI is not visible.

### One-shot / command-response scripts

- `rfid.js` (probe/scan/read/write blocks)

### UI-driven scripts (mostly event based)

- `cc1101.js` (initialize/read/edit/register edits/presets)
- `rfm69.js` (profile actions and probe/RX/TX)
- `sampler.js` (capture/replay/save/load signals)
- `hello.js` (JSX/import smoke example)

### Continuous UI scripts

- `hello.js` (periodic heartbeat UI state)
- `blink.js` (timer based output when running)

### Visible libraries

- `emw-kernel.js` (platform/runtime shim and API surface)
- `emw-protocol.js` (EMW command helpers)
- `emw-ui.js`, `emw-jsx.js` (UI primitives and JSX authoring)
- `emw-gpio.js`, `emw-spi.js`, `emw-i2c.js`, `emw-uart.js`, `emw-adc.js`, `emw-pwm.js`
- `emw-fs.js`, `emw-sampler.js`

## UI snapshot contract

Default scripts are UI programs. Visible state for CLI, browser, native app, and
Agent workflows must be rendered through `render(<App />)` from `emw-jsx` and read through
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
