---
title: Wavelets
---

# Wavelets

Wavelets are JavaScript scripts that render portable UI and orchestrate EMWaver hardware workflows without requiring custom native app builds.

## UI and Components

Wavelets build UI by constructing a tree of components and passing it to `UI.render(...)`. Every node is a plain object created by calling a `UI.*` function (for example `UI.column({ ... })`).

### Rendering model

- Start with module-scoped state (`let ...`) at the top of the script.
- Implement a `render()` function that calls `UI.render(...)`.
- Update state inside event handlers (`onTap`, `onChange`, `onSubmit`), then call `render()` again.

```javascript title="Minimal wavelet UI"
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

Wavelets run inside a sandbox that exposes a small set of global objects. The exact set can vary by surface (Android, iOS, desktop, CLI). For now, the docs only cover the three public wavelet classes below.

### `DeviceConnection`

`DeviceConnection` is the transport-agnostic way to talk to an attached device (BLE or USB).

- `DeviceConnection.sendCommandString(command, timeoutMs?)` → response bytes (or `null` on failure)
  - Appends a trailing `\\n` if missing.
  - If `timeoutMs` is omitted, the runtime uses a default timeout.
- `DeviceConnection.sendPacket(bytes, timeoutMs?)` → response bytes (or `null` on failure)
  - Byte-level equivalent of `sendCommandString(...)` (use `createByteArray([...])` when you need a host-native byte buffer).
- `DeviceConnection.write(bytes)` → `void` (stream/write without expecting a response)
- `DeviceConnection.connectionStatus()` → `string` (if provided by the host)

`sendCommandString(...)` is typically used with the EMWaver ASCII command protocol (verbs + flags) like `gpio read --pin=4` or `cc1101 set_freq --mhz=433.92`.

### `emw`

Convenience aliases for common device operations.

- `emw.send(command, timeoutMs?)` → same as `DeviceConnection.sendCommandString(...)`
- `emw.sendPacket(bytes, timeoutMs?)` → same as `DeviceConnection.sendPacket(...)`

### `Utils`

Utility helpers provided by the host runtime.

- `Utils.delay(ms)` → `void` (blocking sleep)
- `Utils.sleep(ms)` → `void` (alias on some hosts)

### `SamplerSignals`

Access to saved sampler signals (typically `.raw` captures stored by the app).

- `SamplerSignals.listSignals()` → `string[]`
  - Returns available signal filenames (usually ending in `.raw`).
- `SamplerSignals.listSignalsCsv()` → `string`
  - Returns newline-separated filenames (empty string if none).
- `SamplerSignals.readSignal(name)` → bytes (or `null`)
  - Reads the contents of a saved signal by filename.
