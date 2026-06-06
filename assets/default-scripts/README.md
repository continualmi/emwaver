# Default Script Assets

This folder is the canonical source for bundled EMWaver scripts:

- macOS now bundles the `.js` scripts and visible `emw-*` libraries from this folder.
- Android still needs a matching runtime migration; the canonical default assets are no longer `.emw`.
- Native apps load from this folder path in repo workflows.

The target public source format is JavaScript. Keep new macOS examples and
libraries as `.js` files with extensionless imports such as `import { pin, gpio }
from "emw-gpio";`.

## Script runtime styles

Use this to reason about script behavior when UI is not visible.

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

## JSX and console contract

Default scripts are JavaScript/JSX programs. User-facing state should be
rendered through `render(<App />)` from `emw-jsx`.

Contract:

- startup context should be visible in the rendered UI:
  - script name, board/module config, selected pins, and defaults,
- action state should be visible in the rendered UI:
  - start/transition/complete states for user actions such as start/stop,
    open/read/write, probe/init/reset, save/load, and scan,
- user-facing warnings/errors should be visible in the rendered UI:
  - human-readable status text,
  - enough detail for a person to understand the next step.

Use `console.log`, `console.warn`, and `console.error` for diagnostic output,
external tool runs, and short-lived script-run observations. Console output is
not a replacement for JSX UI; it is the script terminal channel.
