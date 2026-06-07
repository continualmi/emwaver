# Default Script Assets

This folder is the canonical source for bundled EMWaver scripts:

- macOS now bundles the `.emw` scripts and visible `emw-*` libraries from this folder.
- Android still needs matching runtime parity; the canonical default assets are JavaScript files.
- Native apps load from this folder path in repo workflows.

The target public source format is JavaScript. Keep new macOS examples and
libraries as `.emw` files with extensionless imports such as `import { pin, gpio }
from "emw-gpio";`.

## Script runtime styles

Use this to reason about script behavior when UI is not visible.

### One-shot / command-response scripts

- `rfid.emw` (probe/scan/read/write blocks)

### UI-driven scripts (mostly event based)

- `cc1101.emw` (initialize/read/edit/register edits/presets)
- `rfm69.emw` (profile actions and probe/RX/TX)
- `sampler.emw` (capture/replay/save/load signals)
- `hello.emw` (JSX/import smoke example)

### Continuous UI scripts

- `hello.emw` (periodic heartbeat UI state)
- `blink.emw` (timer based output when running)

### Visible libraries

- `emw-kernel.emw` (platform/runtime shim and API surface)
- `emw-protocol.emw` (EMW command helpers)
- `emw-ui.emw`, `emw-jsx.emw` (UI primitives and JSX authoring)
- `emw-gpio.emw`, `emw-spi.emw`, `emw-i2c.emw`, `emw-uart.emw`, `emw-adc.emw`, `emw-pwm.emw`
- `emw-fs.emw`, `emw-sampler.emw`

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
