export default function PinoutDocPage() {
  return (
    <>
      <h1>Pinout</h1>
      <p>GPIO numbering model, header map, and the pins that matter on the current board.</p>

      <h2>Diagram</h2>
      <div className="grid gap-4 md:grid-cols-1">
        <div className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)]">
          <img
            src="/EMWAVER.jpg"
            alt="EMWaver device"
            className="h-auto w-full object-cover"
          />
        </div>
      </div>

      <h2>GPIO numbering</h2>
      <p>Pins are addressed by a single integer:</p>
      <ul>
        <li>
          <code>0..15</code> maps to <code>A0..A15</code> (PA0..PA15)
        </li>
        <li>
          <code>16..31</code> maps to <code>B0..B15</code> (PB0..PB15)
        </li>
      </ul>

      <h2>Relevant pins (current board)</h2>
      <div className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)]">
        <table className="m-0 w-full text-sm">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left">GPIO index</th>
              <th className="px-4 py-3 text-left">Pin</th>
              <th className="px-4 py-3 text-left">Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-4 py-3">0</td>
              <td className="px-4 py-3">A0 (PA0)</td>
              <td className="px-4 py-3">IR_RX (internal)</td>
            </tr>
            <tr>
              <td className="px-4 py-3">1</td>
              <td className="px-4 py-3">A1 (PA1)</td>
              <td className="px-4 py-3">IR_TX (internal)</td>
            </tr>
            <tr>
              <td className="px-4 py-3">2</td>
              <td className="px-4 py-3">A2 (PA2)</td>
              <td className="px-4 py-3">CC1101 GDO0 (internal)</td>
            </tr>
            <tr>
              <td className="px-4 py-3">3</td>
              <td className="px-4 py-3">A3 (PA3)</td>
              <td className="px-4 py-3">CC1101 GDO2 (internal)</td>
            </tr>
            <tr>
              <td className="px-4 py-3">4</td>
              <td className="px-4 py-3">A4 (PA4)</td>
              <td className="px-4 py-3">NSS</td>
            </tr>
            <tr>
              <td className="px-4 py-3">5</td>
              <td className="px-4 py-3">A5 (PA5)</td>
              <td className="px-4 py-3">SCK</td>
            </tr>
            <tr>
              <td className="px-4 py-3">6</td>
              <td className="px-4 py-3">A6 (PA6)</td>
              <td className="px-4 py-3">MISO</td>
            </tr>
            <tr>
              <td className="px-4 py-3">7</td>
              <td className="px-4 py-3">A7 (PA7)</td>
              <td className="px-4 py-3">MOSI</td>
            </tr>
            <tr>
              <td className="px-4 py-3">13</td>
              <td className="px-4 py-3">A13 (PA13)</td>
              <td className="px-4 py-3">SWCLK</td>
            </tr>
            <tr>
              <td className="px-4 py-3">14</td>
              <td className="px-4 py-3">A14 (PA14)</td>
              <td className="px-4 py-3">SWDIO</td>
            </tr>
            <tr>
              <td className="px-4 py-3">22</td>
              <td className="px-4 py-3">B6 (PB6)</td>
              <td className="px-4 py-3">UART TX / I2C SCL</td>
            </tr>
            <tr>
              <td className="px-4 py-3">23</td>
              <td className="px-4 py-3">B7 (PB7)</td>
              <td className="px-4 py-3">UART RX / I2C SDA</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Headers</h2>
      <p>Infrared and CC1101 pins are internal-only and are not routed to headers:</p>
      <div className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)]">
        <table className="m-0 w-full text-sm">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left">Pin</th>
              <th className="px-4 py-3 text-left">Function</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-4 py-3">A0</td>
              <td className="px-4 py-3">IR_RX</td>
            </tr>
            <tr>
              <td className="px-4 py-3">A1</td>
              <td className="px-4 py-3">IR_TX</td>
            </tr>
            <tr>
              <td className="px-4 py-3">A2</td>
              <td className="px-4 py-3">CC1101 GDO0</td>
            </tr>
            <tr>
              <td className="px-4 py-3">A3</td>
              <td className="px-4 py-3">CC1101 GDO2</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>1x8</h3>
      <div className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)]">
        <table className="m-0 w-full text-sm">
          <thead>
            <tr>
              <th className="px-3 py-3 text-left">1</th>
              <th className="px-3 py-3 text-left">2</th>
              <th className="px-3 py-3 text-left">3</th>
              <th className="px-3 py-3 text-left">4</th>
              <th className="px-3 py-3 text-left">5</th>
              <th className="px-3 py-3 text-left">6</th>
              <th className="px-3 py-3 text-left">7</th>
              <th className="px-3 py-3 text-left">8</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-3 py-3">VCC</td>
              <td className="px-3 py-3">B6</td>
              <td className="px-3 py-3">GND</td>
              <td className="px-3 py-3">B7</td>
              <td className="px-3 py-3">A6 (MISO)</td>
              <td className="px-3 py-3">A7 (MOSI)</td>
              <td className="px-3 py-3">A5 (SCK)</td>
              <td className="px-3 py-3">A13 (SWCLK)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>2x4</h3>
      <p>
        Pin numbering follows the common 2xN convention (odd pins on the bottom row, even pins on the
        top row).
      </p>
      <div className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)]">
        <table className="m-0 w-full text-sm">
          <tbody>
            <tr>
              <td className="px-3 py-3">2: VCC</td>
              <td className="px-3 py-3">4: A14 (SWDIO)</td>
              <td className="px-3 py-3">6: A7 (MOSI)</td>
              <td className="px-3 py-3">8: B7</td>
            </tr>
            <tr>
              <td className="px-3 py-3">1: GND</td>
              <td className="px-3 py-3">3: B6</td>
              <td className="px-3 py-3">5: A5 (SCK)</td>
              <td className="px-3 py-3">7: A6 (MISO)</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
