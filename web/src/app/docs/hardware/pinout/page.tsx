export default function PinoutDocPage() {
  return (
    <>
      <h1>Pinout</h1>
      <p>GPIO numbering model, header map, and the pins that matter on the shipping board.</p>

      <h2>GPIO numbering</h2>
      <p>Pins are addressed by a single integer (firmware encoding):</p>
      <ul>
        <li>
          <code>0..7</code> maps to <code>A0..A7</code> (PA0..PA7)
        </li>
        <li>
          <code>16..31</code> maps to <code>B0..B15</code> (PB0..PB15)
        </li>
      </ul>
      <p>
        On the <b>shipping board</b>, only <code>A0..A7</code> plus <code>B6</code>/<code>B7</code> are
        routed for user I/O.
      </p>

      <h2>Key pins</h2>
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
              <td className="px-4 py-3">IR_RX</td>
            </tr>
            <tr>
              <td className="px-4 py-3">1</td>
              <td className="px-4 py-3">A1 (PA1)</td>
              <td className="px-4 py-3">IR_TX</td>
            </tr>
            <tr>
              <td className="px-4 py-3">2</td>
              <td className="px-4 py-3">A2 (PA2)</td>
              <td className="px-4 py-3">GDO0 (GPIO)</td>
            </tr>
            <tr>
              <td className="px-4 py-3">3</td>
              <td className="px-4 py-3">A3 (PA3)</td>
              <td className="px-4 py-3">GDO2 (GPIO)</td>
            </tr>
            <tr>
              <td className="px-4 py-3">4</td>
              <td className="px-4 py-3">A4 (PA4)</td>
              <td className="px-4 py-3">NSS (SPI CS)</td>
            </tr>
            <tr>
              <td className="px-4 py-3">5</td>
              <td className="px-4 py-3">A5 (PA5)</td>
              <td className="px-4 py-3">SCK (SPI)</td>
            </tr>
            <tr>
              <td className="px-4 py-3">6</td>
              <td className="px-4 py-3">A6 (PA6)</td>
              <td className="px-4 py-3">MISO (SPI)</td>
            </tr>
            <tr>
              <td className="px-4 py-3">7</td>
              <td className="px-4 py-3">A7 (PA7)</td>
              <td className="px-4 py-3">MOSI (SPI)</td>
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
      <p>
        The shipping board exposes two user headers for connecting to common external modules
        (SPI/I2C/UART + GPIO).
      </p>

      <h3>U4 (1×8)</h3>
      <p>
        Pinout aligns with common 1×8 “RC522/RFID module” headers (power + SPI + two extra pins).
      </p>
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
              <td className="px-3 py-3">BOOT0</td>
              <td className="px-3 py-3">A6 (MISO)</td>
              <td className="px-3 py-3">A7 (MOSI)</td>
              <td className="px-3 py-3">NSS1</td>
              <td className="px-3 py-3">SCL</td>
              <td className="px-3 py-3">B7</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>CN1 (2×4)</h3>
      <p>
        Pinout aligns with common 2×4 “CC1101 module” headers (even though EMWaver itself has no
        sub-GHz radio).
      </p>
      <div className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)]">
        <table className="m-0 w-full text-sm">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left">Pin</th>
              <th className="px-4 py-3 text-left">Signal</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-4 py-3">1</td>
              <td className="px-4 py-3">GND</td>
            </tr>
            <tr>
              <td className="px-4 py-3">2</td>
              <td className="px-4 py-3">VCC</td>
            </tr>
            <tr>
              <td className="px-4 py-3">3</td>
              <td className="px-4 py-3">GDO0 (A2)</td>
            </tr>
            <tr>
              <td className="px-4 py-3">4</td>
              <td className="px-4 py-3">NSS (A4)</td>
            </tr>
            <tr>
              <td className="px-4 py-3">5</td>
              <td className="px-4 py-3">SCK (A5)</td>
            </tr>
            <tr>
              <td className="px-4 py-3">6</td>
              <td className="px-4 py-3">MOSI (A7)</td>
            </tr>
            <tr>
              <td className="px-4 py-3">7</td>
              <td className="px-4 py-3">MISO (A6)</td>
            </tr>
            <tr>
              <td className="px-4 py-3">8</td>
              <td className="px-4 py-3">GDO2 (A3)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-4">
        Note: if you see older docs/scripts referencing <code>A13</code>/<code>A14</code> (SWD) or
        <code>A15</code>, those are not routed on the shipping board.
      </p>
    </>
  );
}
