export default function UiWidgetsDocPage() {
  return (
    <>
      <h1>UI widgets</h1>
      <p>
        Scripts build a declarative UI tree using <code>UI.*</code> factory functions, then
        call <code>UI.render(rootNode)</code> to display it. The tree is serialized to JSON and
        rendered as native views (SwiftUI on Apple platforms, Compose on Android).
      </p>

      <h2>Layout</h2>
      <pre>
        <code className="language-javascript">{`UI.column({ spacing: 12, padding: 16, children: [...] })
UI.row({ spacing: 8, children: [...] })
UI.grid({ columns: 3, spacing: 8, children: [...] })
UI.scroll({ axis: "vertical", children: [...] })
UI.spacer({ minLength: 20 })
UI.divider({})`}</code>
      </pre>

      <h2>Card</h2>
      <p>Groups content with an optional title and subtitle:</p>
      <pre>
        <code className="language-javascript">{`UI.card({
  title: "GPIO Control",
  subtitle: "Pin A0",
  children: [
    UI.button({ label: "Toggle", onTap: toggle }),
  ],
})`}</code>
      </pre>

      <h2>Text</h2>
      <pre>
        <code className="language-javascript">{`UI.text({ text: "Hello" })
UI.text({
  text: "Status: OK",
  font: "headline",
  fontWeight: "bold",
  foregroundColor: "green",
})`}</code>
      </pre>

      <h2>Button</h2>
      <pre>
        <code className="language-javascript">{`UI.button({
  label: "Start capture",
  buttonStyle: "borderedProminent",
  controlSize: "large",
  onTap: startCapture,
})`}</code>
      </pre>

      <h2>Tile</h2>
      <p>A tappable card-like element with title, value, and optional subtitle:</p>
      <pre>
        <code className="language-javascript">{`UI.tile({
  title: "Temperature",
  value: "23.4 °C",
  monospaceValue: true,
  subtitle: "Last reading",
  onTap: refresh,
})`}</code>
      </pre>

      <h2>Slider</h2>
      <pre>
        <code className="language-javascript">{`UI.slider({
  value: duty,
  min: 0,
  max: 4095,
  step: 1,
  label: "Duty cycle",
  onChange: (v) => { duty = v; render(); },
  onSubmit: (v) => { analogWrite(pin, v); },
})`}</code>
      </pre>

      <h2>TextField</h2>
      <pre>
        <code className="language-javascript">{`UI.textField({
  value: input,
  placeholder: "Enter command...",
  onChange: (v) => { input = v; render(); },
  onSubmit: (v) => { sendCommand(v); },
})

// Secure (password) field
UI.textField({ value: pw, secure: true })`}</code>
      </pre>

      <h2>TextEditor</h2>
      <p>Multi-line text input:</p>
      <pre>
        <code className="language-javascript">{`UI.textEditor({
  value: log,
  placeholder: "Output log...",
  minHeight: 200,
  onChange: (v) => { log = v; render(); },
})`}</code>
      </pre>

      <h2>Picker</h2>
      <pre>
        <code className="language-javascript">{`UI.picker({
  selected: selectedPin,
  options: [
    { label: "A0", value: "0" },
    { label: "A1", value: "1" },
    { label: "B6", value: "22" },
  ],
  style: "segmented",  // or "menu", "automatic"
  onChange: (v) => { selectedPin = v; render(); },
})`}</code>
      </pre>

      <h2>Toggle</h2>
      <pre>
        <code className="language-javascript">{`UI.toggle({
  label: "Enable output",
  value: enabled,
  onChange: (v) => { enabled = v; render(); },
})`}</code>
      </pre>

      <h2>Plot</h2>
      <p>
        Interactive chart with pan/zoom. Supports inline data or buffer sources for rendering
        large captured signals efficiently.
      </p>
      <pre>
        <code className="language-javascript">{`// Inline data
UI.plot({
  height: 300,
  dataX: [0, 1, 2, 3, 4],
  dataY: [0, 1, 0, 1, 0],
})

// Live sampler view
UI.plot({
  height: 300,
  source: "samplerBits",
  onViewportChange: (vp) => { /* pan/zoom state */ },
  onSelectRange: (range) => { /* shift+drag selection */ },
})

// Pre-stored buffer
const bufId = UI.buffer(capturedBytes);
UI.plot({
  height: 300,
  source: { kind: "buffer", id: bufId },
})`}</code>
      </pre>

      <h2>LogViewer</h2>
      <p>Read-only scrolling text log:</p>
      <pre>
        <code className="language-javascript">{`UI.logViewer({
  text: logOutput,
  minHeight: 150,
})`}</code>
      </pre>

      <h2>Progress</h2>
      <pre>
        <code className="language-javascript">{`UI.progress({ value: 42, total: 100, label: "Flashing..." })
UI.progress({ label: "Scanning..." })  // indeterminate`}</code>
      </pre>

      <h2>Modal</h2>
      <pre>
        <code className="language-javascript">{`UI.modal({
  open: showModal,
  title: "Confirm",
  subtitle: "Are you sure?",
  onClose: () => { showModal = false; render(); },
  children: [
    UI.button({ label: "OK", onTap: confirm }),
  ],
})`}</code>
      </pre>

      <h2>Common style props</h2>
      <p>These can be applied to any widget:</p>
      <div className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)]">
        <table className="m-0 w-full text-sm">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left">Prop</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-4 py-3"><code>padding</code></td>
              <td className="px-4 py-3">number</td>
              <td className="px-4 py-3">All-sides padding</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>width</code>, <code>height</code></td>
              <td className="px-4 py-3">number</td>
              <td className="px-4 py-3">Fixed size</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>minWidth</code>, <code>maxWidth</code></td>
              <td className="px-4 py-3">number</td>
              <td className="px-4 py-3">Size constraints</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>cornerRadius</code></td>
              <td className="px-4 py-3">number</td>
              <td className="px-4 py-3">Rounded corners</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>backgroundColor</code></td>
              <td className="px-4 py-3">string</td>
              <td className="px-4 py-3">Background color</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>foregroundColor</code></td>
              <td className="px-4 py-3">string</td>
              <td className="px-4 py-3">Text/icon color</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>fillsWidth</code></td>
              <td className="px-4 py-3">boolean</td>
              <td className="px-4 py-3">Expand to fill (default: true)</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>alignment</code></td>
              <td className="px-4 py-3">string</td>
              <td className="px-4 py-3">leading, center, trailing</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Event handlers</h2>
      <div className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)]">
        <table className="m-0 w-full text-sm">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left">Prop</th>
              <th className="px-4 py-3 text-left">Used by</th>
              <th className="px-4 py-3 text-left">Callback argument</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-4 py-3"><code>onTap</code></td>
              <td className="px-4 py-3">button, tile</td>
              <td className="px-4 py-3">none</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>onChange</code></td>
              <td className="px-4 py-3">slider, picker, textField, toggle, textEditor</td>
              <td className="px-4 py-3">new value</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>onSubmit</code></td>
              <td className="px-4 py-3">textField, slider</td>
              <td className="px-4 py-3">final value</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>onViewportChange</code></td>
              <td className="px-4 py-3">plot</td>
              <td className="px-4 py-3">viewport state</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>onSelectRange</code></td>
              <td className="px-4 py-3">plot</td>
              <td className="px-4 py-3">selection range</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>onClose</code></td>
              <td className="px-4 py-3">modal</td>
              <td className="px-4 py-3">none</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
