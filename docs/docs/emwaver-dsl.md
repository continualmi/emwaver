---
title: EMWaver DSL
---

# EMWaver DSL

The EMWaver DSL defines how Wavelets describe user interfaces and bind hardware actions. Scripts are plain JavaScript files that call `UI.render` with declarative component trees; the runtime reconciles those structures into native SwiftUI and Jetpack Compose views.

## Rendering Model

- Instantiate global state at the top of the script.
- Implement a `render()` function that constructs the UI tree and calls `UI.render(...)`.
- Update state inside event handlers, then call `render()` again to refresh the view.
- Subscribe to console streams with `WaveletConsole.subscribe(render)` when the layout should react to new log lines.

```javascript title="default_files/wavelet_demo.js"
const root = UI.column({
    spacing: 12,
    padding: 8,
    children: [
        UI.text({ text: "Wavelet Demo" }),
        UI.row({
            spacing: 8,
            children: [
                UI.button({ label: "Pulse LED", onTap: () => print('Pulse LED requested') }),
                UI.button({ label: "Log Message", onTap: () => print('Wavelet button pressed') })
            ]
        }),
        UI.logViewer({ text: "Console messages will appear below." })
    ]
});

UI.render(root);
```

This pattern keeps the script stateless between renders while still allowing imperative updates through handler callbacks.

## Layout Building Blocks

`UI.column`, `UI.row`, and `UI.scroll` are the primary containers:

- Use `spacing`, `padding`, and `children` to compose vertically stacked sections (`wavelet_demo.js`).
- Wrap long forms in `UI.scroll` to ensure fields remain reachable (`wavelet_rfid.js`).
- Combine `UI.row` buttons for toolbars or segmented controls (`cc1101_radio_console.js`).

```javascript title="default_files/cc1101_radio_console.js"
function render() {
    UI.render(UI.column({
        padding: 16,
        spacing: 16,
        children: [
            UI.text({ text: 'CC1101 Radio', font: 'title2', fontWeight: 'semibold' }),
            UI.row({
                spacing: 12,
                children: [
                    UI.button({ label: 'Init RX', backgroundColor: '#2563EB', foregroundColor: '#FFFFFF', onTap: initRx }),
                    UI.button({ label: 'Init TX', backgroundColor: '#DC2626', foregroundColor: '#FFFFFF', onTap: initTx })
                ]
            }),
            UI.text({ text: message, fontWeight: 'medium', foregroundColor: '#374151' })
        ]
    }));
}
```

## Inputs and Forms

The RFID utility demonstrates how to build multi-field forms with validation and reactive feedback:

- `UI.textField` and `UI.textEditor` capture hex payloads and keys (`wavelet_rfid.js`).
- `UI.picker` supports both dropdown (`style: "menu"`) and segmented styles for selection.
- `UI.grid` lays out repeated components such as the six key bytes.
- Conditional `UI.text` nodes render success or error banners using color-coded backgrounds.

```javascript title="default_files/wavelet_rfid.js"
UI.column({
    spacing: 16,
    children: [
        UI.text({ text: "RFID Tools", font: "title2", fontWeight: "semibold" }),
        UI.textField({
            placeholder: "00",
            value: blockAddress,
            onChange: value => { blockAddress = value.toUpperCase().replace(/[^0-9A-F]/g, "").slice(0, 2); }
        }),
        UI.picker({
            style: "segmented",
            selected: authMode,
            options: [ { label: "Key A", value: 0 }, { label: "Key B", value: 1 } ],
            onChange: value => { authMode = value; }
        }),
        UI.grid({
            columns: 3,
            spacing: 8,
            children: keyInputs.map((keyValue, index) => UI.textField({
                placeholder: "FF",
                value: keyValue,
                onChange: value => { keyInputs[index] = value.toUpperCase().replace(/[^0-9A-F]/g, "").slice(0, 2); }
            }))
        })
    ]
});
```

## Console Integration

- `UI.logViewer()` streams `print` and `console.*` output inline, as shown in `wavelet_demo.js` and `wavelet_gpio.js`.
- For richer terminals, `WaveletConsole.view(...)` mirrors the execution log with theming options. Pair it with `WaveletConsole.subscribe(render)` to re-render as new lines arrive (`hello_world_usb.js`).

```javascript title="default_files/hello_world_usb.js"
WaveletConsole.subscribe(render);

function render() {
    UI.render(UI.column({
        padding: 16,
        spacing: 12,
        children: [
            UI.text({ text: 'BadUSB Hello World', font: 'title2', fontWeight: 'semibold' }),
            UI.button({ label: 'Execute Payload', backgroundColor: '#1D4ED8', foregroundColor: '#FFFFFF', onTap: runDemo }),
            WaveletConsole.view({
                minHeight: 160,
                backgroundColor: '#111827',
                foregroundColor: '#F9FAFB',
                padding: { top: 12, bottom: 12, leading: 12, trailing: 12 }
            })
        ]
    }));
}
```

## Hardware and Device APIs

Wavelets can call into hardware abstractions exposed by the runtime:

- `CC1101.*` handles radio configuration (`cc1101_radio_console.js`).
- `BLEService.sendCommand(...)` exchanges raw packets with the firmware (`wavelet_gpio.js`, `wavelet_rfid.js`).
- `BLEService.sendString(...)` and `Utils.delay(...)` orchestrate BadUSB attacks (`hello_world_usb.js`).

Always wrap hardware calls in `try/catch` blocks and update UI state with clear status messages:

```javascript title="default_files/wavelet_gpio.js"
function gpioRead() {
    if (!BLEService) {
        resultText = "BLE Service not connected";
        render();
        return;
    }
    try {
        const pinNumber = parseInt(selectedPin);
        const command = createByteArray([0x67, 0x70, 0x69, 0x6F, 0x00, pinNumber, 0x52, 0x00]);
        const response = BLEService.sendCommand(command, 2000);
        // ...derive resultText and call render();
    } catch (error) {
        resultText = "GPIO read error: " + error;
        render();
    }
}
```

## State Patterns

- Use module-scoped variables (`let message = 'Ready';`) to track mutable state.
- Call `render()` after mutations to trigger reconciliation.
- When state changes should not re-render immediately (e.g., during background operations), queue updates and invoke `render()` after the operation completes.
- Combine state with conditional nodes (returning `null` to hide a component) as demonstrated by the conditional banner in `wavelet_gpio.js`.

## Best Practices

- **Keep handlers short:** offload long-running tasks to firmware or asynchronous helpers, then refresh the UI.
- **Validate user input:** sanitize text fields before sending commands (e.g., hex filtering in `wavelet_rfid.js`).
- **Log intentionally:** leverage `print` or `console.log` with descriptive messages so the Agents fragment can assist with debugging.
- **Reuse helpers:** extract repeated command builders or parsing utilities to shared modules when authoring complex wavelets.

These examples ship with the EMWaver backend (`default_files/*.js`) and provide a solid starting point for building your own interfaces. Extend them to integrate new hardware workflows while retaining consistent UI behavior across platforms.

