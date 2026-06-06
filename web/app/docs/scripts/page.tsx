import Link from "next/link";

export default function ScriptsDocPage() {
  return (
    <>
      <h1>Scripting guide</h1>
      <p>
        EMWaver scripts are local JavaScript programs. Scripts use <code>.js</code> files and can include
        JSX-style UI syntax for native panels, extensionless imports such as <code>&quot;emw-ui&quot;</code>, and
        hardware modules such as <code>emw-gpio</code>, <code>emw-spi</code>, and <code>emw-sampler</code>.
      </p>
      <h2>How scripts run</h2>
      <ol>
        <li>The app loads the visible runtime libraries from the bundled script assets.</li>
        <li>Imports are resolved from EMWaver modules such as <code>emw-ui</code>, <code>emw-jsx</code>, <code>emw-gpio</code>, and <code>emw-spi</code>.</li>
        <li>JSX-style syntax is transpiled into native EMWaver UI nodes.</li>
        <li>Your script renders a native panel with <code>render(&lt;App /&gt;)</code>.</li>
        <li>Callbacks such as <code>onTap</code>, <code>onChange</code>, and <code>onViewportChange</code> handle user events and then re-render.</li>
      </ol>
      <p>
        Hardware calls are synchronous from the script authoring point of view: a GPIO, SPI, I2C,
        UART, ADC, PWM, or sampler call returns after the local app/board path responds or throws.
      </p>

      <h2>Minimal JSX script</h2>
      <pre>
        <code className="language-javascript">{`import { JSX, render } from "emw-jsx";
import { Column, Text, Button } from "emw-ui";

let count = 0;

function increment() {
  count += 1;
  rerender();
}

function reset() {
  count = 0;
  rerender();
}

function App() {
  return (
    <Column padding={16} spacing={12}>
      <Text font="title2" fontWeight="semibold">Hello</Text>
      <Text>Count: {count}</Text>
      <Button onTap={increment}>Increment</Button>
      <Button onTap={reset}>Reset</Button>
    </Column>
  );
}

function rerender() {
  render(<App />);
}

rerender();`}</code>
      </pre>

      <h2>Script structure</h2>
      <ul>
        <li><strong>Imports</strong>: bring in the UI renderer, JSX factory, components, and hardware modules.</li>
        <li><strong>State</strong>: keep state in normal JavaScript variables.</li>
        <li><strong>Actions</strong>: callbacks mutate state, perform device work, then re-render.</li>
        <li><strong>App component</strong>: returns a JSX-style tree made from EMWaver UI components.</li>
        <li><strong>Render function</strong>: one small <code>render(&lt;App /&gt;)</code> wrapper updates the native panel.</li>
      </ul>

      <h2>Board-aware GPIO example</h2>
      <pre>
        <code className="language-javascript">{`import { JSX, render } from "emw-jsx";
import { Column, Text, Button, Picker } from "emw-ui";
import { pin, gpio } from "emw-gpio";

function boardType() {
  try { return device.boardType(); } catch (e) { return "stm32f042"; }
}

const board = boardType();
const options = board === "esp32s3"
  ? [{ label: "GPIO4", value: "4" }, { label: "GPIO37", value: "37" }]
  : [{ label: "A0", value: "0" }, { label: "A1", value: "1" }];

let selected = options[0].value;
let high = false;

function target() {
  const n = Number(selected);
  return board === "esp32s3" ? pin({ gpio: n }) : pin({ port: "A", number: n });
}

function toggle() {
  high = !high;
  gpio.mode(target(), "output");
  gpio.write(target(), high);
  rerender();
}

function App() {
  return (
    <Column padding={16} spacing={12}>
      <Text font="title2" fontWeight="semibold">GPIO</Text>
      <Text font="caption">Detected: {board}</Text>
      <Picker
        style="menu"
        selected={selected}
        options={options}
        onChange={(value) => { selected = String(value); rerender(); }}
      />
      <Button onTap={toggle}>{high ? "Write LOW" : "Write HIGH"}</Button>
    </Column>
  );
}

function rerender() { render(<App />); }
rerender();`}</code>
      </pre>

      <h2>Bundled modules</h2>
      <div className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)]">
        <table className="m-0 w-full text-sm">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left">Module</th>
              <th className="px-4 py-3 text-left">Exports</th>
              <th className="px-4 py-3 text-left">Use</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="px-4 py-3"><code>emw-jsx</code></td><td className="px-4 py-3"><code>JSX</code>, <code>h</code>, <code>render</code></td><td className="px-4 py-3">JSX transform target and UI rendering.</td></tr>
            <tr><td className="px-4 py-3"><code>emw-ui</code></td><td className="px-4 py-3">UI components</td><td className="px-4 py-3">Native UI tree components such as <code>Column</code>, <code>Button</code>, and <code>Plot</code>.</td></tr>
            <tr><td className="px-4 py-3"><code>emw-gpio</code></td><td className="px-4 py-3"><code>pin</code>, <code>gpio</code></td><td className="px-4 py-3">Pin encoding, GPIO mode/read/write.</td></tr>
            <tr><td className="px-4 py-3"><code>emw-spi</code></td><td className="px-4 py-3"><code>spi</code></td><td className="px-4 py-3">SPI transfers with optional chip select.</td></tr>
            <tr><td className="px-4 py-3"><code>emw-i2c</code></td><td className="px-4 py-3"><code>i2c</code></td><td className="px-4 py-3">I2C open/read/write/write-then-read flows.</td></tr>
            <tr><td className="px-4 py-3"><code>emw-uart</code></td><td className="px-4 py-3"><code>uart</code></td><td className="px-4 py-3">UART open/read/write flows.</td></tr>
            <tr><td className="px-4 py-3"><code>emw-adc</code></td><td className="px-4 py-3"><code>adc</code></td><td className="px-4 py-3">ADC pin/internal-source reads and resolution setting.</td></tr>
            <tr><td className="px-4 py-3"><code>emw-pwm</code></td><td className="px-4 py-3"><code>pwm</code></td><td className="px-4 py-3">PWM writes and resolution setting.</td></tr>
            <tr><td className="px-4 py-3"><code>emw-fs</code></td><td className="px-4 py-3"><code>FS</code></td><td className="px-4 py-3">App-local file helpers.</td></tr>
            <tr><td className="px-4 py-3"><code>emw-sampler</code></td><td className="px-4 py-3"><code>Sampler</code>, <code>SamplerSignals</code></td><td className="px-4 py-3">Signal capture, buffers, replay, and saved signal access.</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Built-in scripts</h2>
      <p>
        The app bundles local examples as JavaScript source. They are both tools and reference implementations.
      </p>
      <div className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)]">
        <table className="m-0 w-full text-sm">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left">Script</th>
              <th className="px-4 py-3 text-left">What it demonstrates</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="px-4 py-3"><code>hello.js</code></td><td className="px-4 py-3">JSX/import smoke test with buttons and state.</td></tr>
            <tr><td className="px-4 py-3"><code>blink.js</code></td><td className="px-4 py-3">Board-aware pin selection, timer-based output, GPIO module use.</td></tr>
            <tr><td className="px-4 py-3"><code>sampler.js</code></td><td className="px-4 py-3">Signal capture, plot viewport callbacks, retransmit, local save/load.</td></tr>
            <tr><td className="px-4 py-3"><code>cc1101.js</code></td><td className="px-4 py-3">CC1101 radio register control, presets, SPI transfers, logs, grids, cards, tiles.</td></tr>
            <tr><td className="px-4 py-3"><code>rfid.js</code></td><td className="px-4 py-3">MFRC522 probe/UID/read/write workflows over SPI and GPIO reset/IRQ pins.</td></tr>
            <tr><td className="px-4 py-3"><code>rfm69.js</code></td><td className="px-4 py-3">Profile-driven RFM69/RFM69HW radio control and RSSI/status UI.</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Timing</h2>
      <pre>
        <code className="language-javascript">{`delay(500);          // blocking sleep (ms)
sleep(100);          // alias for delay
millis();            // milliseconds since the script engine started

const timer = every(1000, () => {
  // periodic work; return false to stop, or call timer.stop()
  rerender();
});
timer.stop();`}</code>
      </pre>
      <p>
        Use rendered panels for user interaction. Desktop MCP hardware automation should use named
        tools such as SPI transfers, GPIO reads/writes, analog reads, and module probes rather than
        screen-scraping UI state.
      </p>

      <h2>Next</h2>
      <ul>
        <li><Link href="/docs/scripts/ui">UI widgets</Link> for every JSX component and prop shape.</li>
        <li><Link href="/docs/scripts/device-api">Device API</Link> for GPIO, buses, sampler, files, and device info.</li>
      </ul>
    </>
  );
}
