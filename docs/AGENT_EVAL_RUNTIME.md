# Agent Hardware Runtime

Status: implemented (macOS native Agent, May 2026)

## Decision

The native Agent controls hardware through direct hardware primitive tools
(`spi_transfer`, `gpio_read`, `gpio_write`, `gpio_mode`, `analog_read`) that
run in the live script engine. The previous approaches — `get_ui_snapshot` /
`send_ui_event` (snapshot navigation), and then `eval` (arbitrary JS snippets)
— have both been removed from the native Agent tool set.

## Why the Snapshot Approach Failed

The snapshot/event model treated the Agent as a screen reader navigating a UI
built for humans. The failure became visible in practice:

When a user asked the Agent to "press the Initialize & Read button" on the
cc1101.emw script, the Agent:

1. Called `get_ui_snapshot` to read the UI tree.
2. Called `send_ui_event` with the correct token — the button press worked.
3. Called `get_ui_snapshot` again to check the result.
4. But the CC1101 initialization is an async SPI transaction. The snapshot
   taken immediately after the press showed a loading/busy state, not a
   completed result.
5. The Agent saw "nothing useful changed", concluded the press had not worked,
   and retried the button three more times.

The root problem is structural. Hardware operations are inherently async.
The snapshot tool returns whatever the UI looks like at that instant — it has
no way to signal that an operation is in flight.

## Why eval Was Also Removed

`eval` let the Agent run arbitrary JS snippets in the live engine. This worked
mechanically but failed in practice: the model does not know the JS API surface
(`SPI.transfer`, `CC1101.readRegister`, etc.) without reading the relevant
bundled script first, and even then it frequently guessed wrong API names.
Named hardware tools solve this at the source — the parameter schema is the
API, and the tool implementation handles the JS internally.

## Current Model: Named Hardware Primitive Tools

The Agent issues typed hardware operations directly. The tool schemas make the
API surface discoverable; the tool implementations encode the correct JS.

```
spi_transfer(bytes=[0x80, 0x00], cs=4, rx_length=2)  →  { rx: [0x00, 0x14] }
gpio_read(pin=A2)  →  { pin: 2, level: 1 }
```

No snapshot timing, no UI state to parse, no retry loops, no guessed JS API names.

## Two Agent Modes

**Explore/control mode** — the Agent calls hardware primitive tools to read
registers, drive pins, send SPI frames, and validate device responses. It can
call `sleep` between operations to allow hardware time to settle.

**Build mode** — once the Agent has verified the hardware behaves as expected,
it writes a full `.emw` script with `UI.render(...)` and calls `run_script`.
The UI is the artifact the user interacts with, not the interface the Agent
uses to operate the hardware.

## Native Agent Tool Set

| Tool | Purpose |
|------|---------|
| `list_scripts` | Discover available `.emw` scripts |
| `read_script` | Read script source |
| `apply_patch_to_script` | Edit a script draft |
| `run_script` | Launch a full script with UI |
| `stop_script` | Stop the running script |
| `get_device_status` | Check device connection and runtime state |
| `spi_transfer` | Send/receive raw SPI bytes (CS pin, TX bytes, optional RX length) |
| `gpio_mode` | Set a pin to INPUT / OUTPUT / INPUT_PULLUP |
| `gpio_write` | Write HIGH or LOW to a digital output pin |
| `gpio_read` | Read the current level (0 or 1) of a digital pin |
| `analog_read` | Read an ADC pin value |
| `sleep` | Wait N ms for hardware operations to settle |

`get_ui_snapshot`, `send_ui_event`, and `eval` are all removed.

## How Hardware Tools Work

Each hardware tool calls `ScriptPreviewManager.eval(js)` internally with a
safe, deterministic JS snippet — e.g. `SPI.transfer([0x80,0x00],{cs:4,rxLength:2})`.
`SPI.transfer`, `pinMode`, `digitalWrite`, `digitalRead`, and `analogRead` are
all defined in `script_bootstrap.emw` (loaded into every JS context via
`ScriptEngine.injectDSL`). They encode the appropriate EMW op-code packet and
call `__emwSendPacket` which routes to `ScriptDevice.sendCommand` on the active
USB/BLE transport.

The hardware tool layer, not the model, owns the JS API details.

## console.log

`console.log`, `console.warn`, and `console.error` remain available in the
`.emw` script runtime on native Apple platforms (installed in
`ScriptEngine.installHostPrimitives`). Output is captured per internal `eval`
call and can surface in tool results. Bundled `.emw` scripts should still
express user-facing state through `UI.render(...)`; `console.log` is an
internal diagnostic channel, not the primary agent output path.
