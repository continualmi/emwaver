---
title: EMWaver scripts
---

# EMWaver scripts

EMWaver scripts are programs written in the EMWaver scripting language. They render portable UI and orchestrate EMWaver hardware workflows without requiring custom native app builds.

## UI and Components

EMWaver scripts build UI by constructing a tree of components and passing it to `UI.render(...)`. Every node is a plain object created by calling a `UI.*` function (for example `UI.column({ ... })`).

### Rendering model

- Start with module-scoped state (`let ...`) at the top of the script.
- Implement a `render()` function that calls `UI.render(...)`.
- Update state inside event handlers (`onTap`, `onChange`, `onSubmit`), then call `render()` again.

```text title="Minimal EMWaver script UI"
let count = 0;

function render() {
    UI.render(UI.column({
        padding: 16,
        spacing: 12,
        children: [
            UI.text({ text: "Count: " + count, font: "title2", fontWeight: "semibold" }),
            UI.button({ label: "Increment", onTap: () => { count += 1; render(); } })
        ]
    }));
}

render();
```

### Common props

Most components accept a common set of props (extra props are ignored or may be platform-specific):

- `id` (string): optional stable identifier (otherwise one is generated).
- `children` (array): nested nodes (use `null` to conditionally hide a child).
- `padding` (number or object): either a single number (all edges), or `{ top, bottom, leading, trailing }`.
- `spacing` (number): spacing between children (for containers).
- `backgroundColor` / `foregroundColor` (string): typically hex colors (for example `#2563EB`).
- `cornerRadius` (number): rounded corners on supported components.

### Layout components

- `UI.column({ children, spacing, padding, ... })`: vertical layout.
- `UI.row({ children, spacing, padding, ... })`: horizontal layout.
- `UI.scroll({ children, spacing, padding, ... })`: scroll container (use for long forms).
- `UI.grid({ columns, spacing, children, ... })`: grid layout (common for repeated inputs).
- `UI.spacer({ ... })`: flexible spacer (exact behavior depends on host renderer).
- `UI.divider({ ... })`: visual separator line.

### Content components

- `UI.text({ text, font, fontWeight, ... })`
  - `text` (string): content to display.
  - `font` (string): semantic font name (for example `title2`).
  - `fontWeight` (string): (for example `medium`, `semibold`).
- `UI.logViewer({ text, minHeight, ... })`
  - Renders logs inline; commonly bound to a growing `logLines.join("\\n")` buffer.

### Input components

- `UI.button({ label, onTap, ... })`
- `UI.textField({ value, placeholder, onChange, onSubmit, ... })`
- `UI.textEditor({ value, placeholder, onChange, ... })`
- `UI.picker({ style, selected, options, onChange, ... })`
  - `style`: `"menu"` or `"segmented"`.
  - `options`: `[{ label, value }, ...]`.
- `UI.slider({ value, onChange, ... })`: slider input (exact range/step props depend on the host renderer).
- `UI.progress({ ... })`: progress indicator (props depend on the host renderer).

### Events

Event handlers are passed as functions in props:

- `onTap`: buttons.
- `onChange`: inputs/pickers/sliders.
- `onSubmit`: text fields (if supported by the host).

Handlers should be fast; for longer device operations, update UI state with a status message and re-render as you go.

## APIs

Scripts run inside a sandbox that exposes a small set of global objects. The exact set can vary by surface (Android, iOS, desktop, CLI).

### Arduino-like API (recommended)

The lowest-level interface is the ASCII command protocol (via `emw.send(...)`). On desktop/mobile, the default script runtime loads `script_bootstrap.emw`, which exposes an Arduino-ish convenience layer as thin wrappers over the command protocol:

- Digital IO: `pinMode(pin, INPUT|OUTPUT)`, `digitalRead(pin)`, `digitalWrite(pin, LOW|HIGH)`
- ADC input: `analogRead(pin, { samples? })`, `analogReadResolution(bits)` (defaults to 12-bit on STM32F0)
- Internal ADC sources: `analogReadTemp()`, `analogReadVrefint()`, `analogReadVbat()`
- PWM output: `analogWrite(pin, value, { hz?, timeout? })`, `analogWriteResolution(bits)` (PWM currently supports `PA0..PA3` only)
- SPI: `SPI.transfer(txBytes, { cs?, rxLength? })` (maps to `spi xfer ...`)
- I2C: `Wire.begin({ hz? })`, `Wire.write(...)`, `Wire.read(...)`, `Wire.xfer(...)`
- UART: `Serial.begin(baud)`, `Serial.write(...)`, `Serial.read(...)`, `Serial.end()`

For now, the docs cover the public runtime classes below.

### `DeviceConnection`

`DeviceConnection` is the transport-agnostic way to talk to an attached device (USB).

- `DeviceConnection.sendCommandString(command, timeoutMs?)` → response bytes (or `null` on failure)
  - Appends a trailing `\\n` if missing.
  - If `timeoutMs` is omitted, the runtime uses a default timeout.
- `DeviceConnection.sendPacket(bytes, timeoutMs?)` → response bytes (or `null` on failure)
  - Byte-level equivalent of `sendCommandString(...)` (use `createByteArray([...])` when you need a host-native byte buffer).
- `DeviceConnection.write(bytes)` → `void` (stream/write without expecting a response)
- `DeviceConnection.connectionStatus()` → `string` (if provided by the host)

`sendCommandString(...)` is typically used with the EMWaver ASCII command protocol (verbs + flags) like `gpio read --pin=4`, `spi xfer --cs=4 --tx=F100 --rx=2`, or `adc read --src=temp`.

### `emw`

Convenience aliases for common device operations.

- `emw.send(command, timeoutMs?)` → same as `DeviceConnection.sendCommandString(...)`
- `emw.sendPacket(bytes, timeoutMs?)` → same as `DeviceConnection.sendPacket(...)`

### `device`

High-level device helpers.

- `await device.version()` → `string`
- `await device.reset()` → `void` (triggers an STM32 `NVIC_SystemReset()` on the device)

### `Utils`

Utility helpers provided by the host runtime.

- `Utils.delay(ms)` → `void` (blocking sleep)
- `Utils.sleep(ms)` → `void` (alias on some hosts)

### Timing helpers

Best-effort host-side timing utilities (not suitable for precise MCU timing).

- `millis()` → `number` (milliseconds since script start; monotonic when available)
- `await delay(ms)` → `Promise<void>` (non-blocking sleep when timers are available on the host)
- `every(periodMs, fn, { mode? })` → `{ stop() }`
  - `fn` may be async; ticks do not overlap.
  - `mode: "fixedRate"` (default) skips ticks when a run overruns the period; `"fixedDelay"` waits `periodMs` after each run.

### `SamplerSignals`

Access to saved sampler signals (typically `.raw` captures stored by the app).

- `SamplerSignals.listSignals()` → `string[]`
  - Returns available signal filenames (usually ending in `.raw`).
- `SamplerSignals.listSignalsCsv()` → `string`
  - Returns newline-separated filenames (empty string if none).
- `SamplerSignals.readSignal(name)` → bytes (or `null`)
  - Reads the contents of a saved signal by filename.

### `Sampler` (desktop only)

Live sampler capture from the device (`sample start/stop`) while keeping bytes in the shared RX buffer.

- `await Sampler.start({ pin, clearBefore?, invert? })` → `{ id, startPacket }`
- `await Sampler.stop(id?)` → `void`
- `await Sampler.status(id?)` → `{ active, pin?, packetCount, lenBytes }`
- `await Sampler.capture({ pin, durationMs, clearBefore?, invert? })` → `{ bytes, startPacket, endPacket, bufferLenBytes }`
- Buffer access while running (polling):
  - `await Sampler.buffer.readPacketsSince({ packetIndex, maxPackets? })` → `{ data, nextPacketIndex, availablePackets }`
  - `await Sampler.buffer.firstBytes(n)` / `await Sampler.buffer.lastBytes(n)` / `await Sampler.buffer.sliceBytes(start, end)`
  - `await Sampler.buffer.compressViewport({ startBit, endBit, bins })` → `{ bufferLenBytes, timeValues, dataValues }`
