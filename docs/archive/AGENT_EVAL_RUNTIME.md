# Agent Script Runtime

Status: macOS pivot implemented (June 2026)

## Decision

The macOS native Agent operates hardware by writing and running normal EMWaver
JavaScript/JSX scripts. The script is the artifact: it can be an existing
bundled/custom script or an unsaved ephemeral script, similar to `python -c`.

The macOS Agent no longer exposes direct hardware primitive tools such as
`spi_transfer`, `gpio_read`, `gpio_write`, `gpio_mode`, or `analog_read`.
Hardware access should go through the same script libraries users see, such as
`emw-gpio`, `emw-spi`, `emw-i2c`, `emw-adc`, and JSX UI modules.

## Why

The previous primitive-tool model made the Agent useful for quick probing, but
it created a second hardware-control path that users could not directly inspect
or keep. The script-first model keeps EMWaver aligned with its product shape:
local scripts, visible code, reusable examples, and no hidden cloud or native
activation path for local hardware control.

`eval` also remains out of the Agent tool set. The Agent should create or patch
real script source, then run that source through the local runtime.

## Script Observation

`console.log`, `console.warn`, and `console.error` are the Agent's diagnostic
observation channel for script runs. The macOS app captures console output from
normal script execution, shows it in the Scripts console pane, and returns a
recent console tail through Agent script-status tool results.

Scripts should still use JSX for user-facing UI:

```js
import { JSX, render } from "emw-jsx";
import { Column, Text } from "emw-ui";

console.log("probing board");

function App() {
  return (
    <Column>
      <Text>Ready</Text>
    </Column>
  );
}

render(<App />);
```

Rendered JSX is for the user. Console output is for diagnostics, Agent
iteration, and short-lived probe scripts.

## macOS Agent Tool Set

| Tool | Purpose |
|------|---------|
| `list_scripts` | Discover bundled and custom JavaScript scripts |
| `read_script` | Read script source |
| `apply_patch_to_script` | Edit a script draft |
| `run_script` | Launch an existing bundled/custom script |
| `run_ephemeral_script` | Run unsaved JavaScript/JSX source without creating a script record |
| `stop_script` | Stop the active script runtime |
| `get_device_status` | Check local device/runtime state |
| `get_script_status` | Return active script state, latest error, render state, and recent console output |
| `sleep` | Wait N ms before checking script status again |

`get_ui_snapshot`, `send_ui_event`, `eval`, and direct SPI/GPIO/ADC primitive
tools are not part of the macOS Agent tool set.
