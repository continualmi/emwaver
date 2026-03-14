import Link from "next/link";

export default function ScriptsDocPage() {
  return (
    <>
      <h1>Scripting guide</h1>
      <p>
        EMWaver scripts are <code>.emw</code> files written in JavaScript. Each script combines
        hardware I/O and UI in one file — run it and you get a native interface on your phone or
        desktop that talks directly to the board.
      </p>

      <h2>How scripts run</h2>
      <ol>
        <li>The app injects the EMWaver runtime (device APIs, UI system, pin constants).</li>
        <li>Your script executes synchronously — all device calls block until the board responds.</li>
        <li>
          Call <code>UI.render()</code> to display a UI tree. Register callbacks (
          <code>onTap</code>, <code>onChange</code>) for interactivity.
        </li>
        <li>
          Use <code>every(ms, fn)</code> for periodic updates (polling sensors, refreshing
          readings).
        </li>
      </ol>

      <blockquote>
        Scripts are synchronous only — no <code>async</code>/<code>await</code> or Promises.
        Device commands block until a response is received from the board.
      </blockquote>

      <h2>Script structure</h2>
      <p>A typical script follows this pattern:</p>
      <pre>
        <code className="language-javascript">{`// State
let count = 0;
let pin = A0;

// Actions
function toggle() {
  count++;
  digitalWrite(pin, count % 2 ? HIGH : LOW);
  render();
}

// UI
function render() {
  UI.render(
    UI.column({
      children: [
        UI.text({ text: "Toggle count: " + count }),
        UI.button({ label: "Toggle", onTap: toggle }),
      ],
    })
  );
}

render();`}</code>
      </pre>
      <p>
        State is plain JavaScript variables. When something changes, mutate state and call your
        render function to rebuild the UI. The pattern is similar to immediate-mode UI — you
        rebuild the full tree on every update.
      </p>

      <h2>Board detection</h2>
      <p>
        Scripts can detect the connected board type at runtime to adapt pin lists and behavior:
      </p>
      <pre>
        <code className="language-javascript">{`const board = device.boardType();
// "stm32f042", "stm32f103", "esp32s3", etc.

if (board === "esp32s3") {
  // different pin assignments
}`}</code>
      </pre>

      <h2>Pin constants</h2>
      <p>Pins are addressed by named constants that resolve to firmware pin indices:</p>
      <div className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)]">
        <table className="m-0 w-full text-sm">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left">Constant</th>
              <th className="px-4 py-3 text-left">Pin</th>
              <th className="px-4 py-3 text-left">Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-4 py-3"><code>IR_RX</code></td>
              <td className="px-4 py-3">A0</td>
              <td className="px-4 py-3">Infrared receiver</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>IR_TX</code></td>
              <td className="px-4 py-3">A1</td>
              <td className="px-4 py-3">Infrared transmitter</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>GDO0</code>, <code>GDO2</code></td>
              <td className="px-4 py-3">A2, A3</td>
              <td className="px-4 py-3">CC1101 GPIO lines</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>NSS</code> / <code>CC1101_CS</code></td>
              <td className="px-4 py-3">A4</td>
              <td className="px-4 py-3">SPI chip select</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>SCK</code>, <code>MISO</code>, <code>MOSI</code></td>
              <td className="px-4 py-3">A5, A6, A7</td>
              <td className="px-4 py-3">SPI bus</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>I2C_SCL</code> / <code>UART_TX</code></td>
              <td className="px-4 py-3">B6</td>
              <td className="px-4 py-3">Shared I2C/UART</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>I2C_SDA</code> / <code>UART_RX</code></td>
              <td className="px-4 py-3">B7</td>
              <td className="px-4 py-3">Shared I2C/UART</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Direction constants: <code>INPUT</code>, <code>OUTPUT</code>.
        Level constants: <code>HIGH</code> (1), <code>LOW</code> (0).
      </p>

      <h2>Built-in scripts</h2>
      <p>
        The app ships with default scripts covering common workflows. These serve as both tools
        and reference implementations:
      </p>
      <div className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)]">
        <table className="m-0 w-full text-sm">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left">Script</th>
              <th className="px-4 py-3 text-left">What it does</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-4 py-3"><code>hello.emw</code></td>
              <td className="px-4 py-3">Minimal example — renders text and blinks a pin</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>blink.emw</code></td>
              <td className="px-4 py-3">Configurable blink with period slider and pin picker</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>gpio.emw</code></td>
              <td className="px-4 py-3">Digital output control with pin selection</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>adc.emw</code></td>
              <td className="px-4 py-3">ADC readings with source picker and sample averaging</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>pwm.emw</code></td>
              <td className="px-4 py-3">PWM output with frequency and duty cycle controls</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>sampler.emw</code></td>
              <td className="px-4 py-3">
                Signal capture, waveform plot, retransmit, save/load
              </td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>uart.emw</code></td>
              <td className="px-4 py-3">UART terminal with baud config and TX/RX log</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>i2c.emw</code></td>
              <td className="px-4 py-3">I2C explorer — scan, read, write, transfer</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>cc1101.emw</code></td>
              <td className="px-4 py-3">CC1101 sub-GHz radio — registers, presets, packet TX</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>rfid.emw</code></td>
              <td className="px-4 py-3">MFRC522 RFID reader — scan UIDs, read/write blocks</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code>rfm69.emw</code></td>
              <td className="px-4 py-3">RFM69 radio — profiles, RX/TX modes, RSSI</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Timing</h2>
      <pre>
        <code className="language-javascript">{`delay(500);          // blocking sleep (ms)
sleep(100);          // alias for delay
millis();            // ms since script engine start

// periodic timer — returns { stop() }
const timer = every(1000, () => {
  // runs every 1s
  render();
});
timer.stop();        // cancel`}</code>
      </pre>

      <h2>File system</h2>
      <p>Scripts can read and write files on the host device:</p>
      <pre>
        <code className="language-javascript">{`const dir = FS.appDataDir();
FS.ensureDir(FS.join(dir, "captures"));

FS.writeText(FS.join(dir, "log.txt"), "hello");
const text = FS.readText(FS.join(dir, "log.txt"));

FS.writeBytes(FS.join(dir, "data.bin"), [0x01, 0x02]);
const bytes = FS.readBytes(FS.join(dir, "data.bin"));`}</code>
      </pre>

      <h2>Next</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Link
          href="/docs/scripts/device-api"
          className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
        >
          <div className="text-xs font-semibold text-[color:var(--aqua)]">Reference</div>
          <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">Device API</div>
          <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
            GPIO, SPI, I2C, UART, ADC, PWM, Sampler.
          </div>
        </Link>
        <Link
          href="/docs/scripts/ui"
          className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
        >
          <div className="text-xs font-semibold text-[color:var(--copper)]">Reference</div>
          <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">UI widgets</div>
          <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
            Buttons, sliders, plots, text fields, modals, and layout.
          </div>
        </Link>
      </div>
    </>
  );
}
