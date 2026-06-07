import Link from "next/link";

export default function WindowsCc1101Tutorial() {
  return (
    <>
      <h1>Set up CC1101 on Windows (433 MHz)</h1>
      <p>
        This tutorial shows how to wire a CC1101 module to an ESP32-family EMWaver device,
        run the built-in <code>cc1101.emw</code> script, initialize the radio for
        433.92 MHz ASK/OOK transmit mode, and turn on a continuous carrier.
      </p>

      <blockquote>
        Only transmit on frequencies, power levels, and duty cycles permitted in your location.
        For bench testing, use a very short antenna, attenuator, or dummy load where appropriate.
      </blockquote>

      <h2>What you&rsquo;ll need</h2>
      <ul>
        <li>A Windows 11 PC with the EMWaver app installed.</li>
        <li>An ESP32-family board running EMWaver firmware (ESP32, ESP32-S2, or ESP32-S3).</li>
        <li>A CC1101 433 MHz module.</li>
        <li>Jumper wires and a suitable 433 MHz antenna or controlled test setup.</li>
      </ul>
      <p>
        If the board is not flashed yet, start with the{" "}
        <Link href="/docs/tutorials/windows-flashing">Windows firmware flashing tutorial</Link>.
      </p>

      <h2>1. Wire the CC1101 to ESP32 SPI</h2>
      <p>
        Wire the CC1101 module to the ESP32 SPI pins used by the built-in script defaults.
        The table below shows the defaults for ESP32-S2 and ESP32-S3. For classic ESP32, the
        default pins differ: CS=GPIO21, MOSI=GPIO23, MISO=GPIO19, SCK=GPIO18, GDO0=GPIO4.
        You can change any pin in the script pickers.
      </p>
      <div className="my-4 overflow-x-auto rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)]">
        <table className="min-w-full text-sm">
          <thead>
            <tr>
              <th>CC1101 pin</th>
              <th>ESP32 pin</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>VCC</code></td>
              <td><code>3V3</code></td>
              <td>Power. Do not use 5 V.</td>
            </tr>
            <tr>
              <td><code>GND</code></td>
              <td><code>GND</code></td>
              <td>Common ground.</td>
            </tr>
            <tr>
              <td><code>CSN</code> / <code>CS</code></td>
              <td><code>GPIO10</code></td>
              <td>SPI chip select. You can change this in the script picker.</td>
            </tr>
            <tr>
              <td><code>SI</code> / <code>MOSI</code></td>
              <td><code>GPIO11</code></td>
              <td>SPI MOSI.</td>
            </tr>
            <tr>
              <td><code>SO</code> / <code>MISO</code></td>
              <td><code>GPIO13</code></td>
              <td>SPI MISO.</td>
            </tr>
            <tr>
              <td><code>SCK</code></td>
              <td><code>GPIO12</code></td>
              <td>SPI clock.</td>
            </tr>
            <tr>
              <td><code>GDO0</code></td>
              <td><code>GPIO2</code></td>
              <td>Carrier/data gate. You can change this in the script picker.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        In this example, <strong>CS is GPIO10</strong> and <strong>GDO0 is GPIO2</strong>.
        If your wiring differs, use the pickers in the script to select the correct pins.
      </p>

      <h2>2. Connect the EMWaver device</h2>
      <p>
        Connect your flashed EMWaver device to the Windows app. The screenshot below uses BLE,
        but the same script flow applies over any supported EMWaver transport.
      </p>

      <figure className="my-6 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-3">
        <img
          src="/tutorials/windows-cc1101-device-preview.png"
          alt="EMWaver Windows app showing a connected device and CC1101 script preview controls"
          className="w-full rounded-xl border border-[color:var(--line)]"
        />
        <figcaption className="mt-3 text-sm leading-6 text-[color:var(--ink-dim)]">
          Connected EMWaver device with the <code>cc1101.emw</code> script open. Use the Preview
          button at the top to render the script UI.
        </figcaption>
      </figure>

      <h2>3. Open and preview <code>cc1101.emw</code></h2>
      <ol>
        <li>Open the <strong>Scripts</strong> view.</li>
        <li>Select the built-in <code>cc1101.emw</code> script.</li>
        <li>Click <strong>Preview</strong> at the top of the script editor.</li>
      </ol>
      <p>
        In the first <strong>Device</strong> card, confirm the board type and pin selections.
        For this tutorial, use <strong>ESP32</strong>, <strong>CS = GPIO10</strong>, and
        <strong>GDO0 = GPIO2</strong> unless your wiring is different.
      </p>

      <h2>4. Initialize the radio and read registers</h2>
      <p>
        Click <strong>Initialize &amp; Read</strong> in the first card. This probes the CC1101 over
        SPI and reads the current register state into the UI. This is a good first check that
        wiring and SPI communication are working.
      </p>
      <p>
        If the probe fails, re-check power, ground, CS, MOSI, MISO, SCK, and the selected CS pin.
      </p>

      <h2>5. Scroll to Quick Presets and click Init TX</h2>
      <p>
        Scroll down to the <strong>Quick Presets</strong> card. Click{" "}
        <strong>Init TX (433.92 ASK)</strong>.
      </p>
      <p>
        This sends the CC1101 register writes for the known-good 433.92 MHz ASK/OOK transmit
        preset. It sets the frequency, data rate, modulation, PA table, packet/control registers,
        and GDO configuration. In TX mode, <strong>GDO0 becomes the carrier/data gate</strong>.
      </p>

      <figure className="my-6 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-3">
        <img
          src="/tutorials/windows-cc1101-quick-presets.png"
          alt="CC1101 Quick Presets card showing Init TX, Init RX, Carrier ON, IDLE, and Probe buttons"
          className="w-full rounded-xl border border-[color:var(--line)]"
        />
        <figcaption className="mt-3 text-sm leading-6 text-[color:var(--ink-dim)]">
          Use <strong>Init TX (433.92 ASK)</strong> first, then use <strong>Carrier ON</strong>
          to gate the 433 MHz carrier through GDO0.
        </figcaption>
      </figure>

      <h2>6. Verify 433.92 MHz</h2>
      <p>
        After clicking <strong>Init TX (433.92 ASK)</strong>, go back to the first card and click
        <strong>Initialize &amp; Read</strong> again. The RF parameter tiles should now show a
        frequency close to <strong>433.920000 MHz</strong>.
      </p>
      <p>
        If you read the radio before applying the TX preset, the frequency may show the module&rsquo;s
        previous/default configuration instead. Apply <strong>Init TX</strong>, then read again.
      </p>

      <h2>7. Turn on the carrier</h2>
      <p>
        In the <strong>Quick Presets</strong> card, click <strong>Carrier ON</strong>. The script
        drives the selected GDO0 pin high, which gates the CC1101 TX carrier on at 433.92 MHz.
      </p>
      <p>
        Click <strong>Carrier OFF</strong> or <strong>IDLE</strong> when you are done testing.
      </p>

      <h2>Quick troubleshooting</h2>
      <ul>
        <li>
          <strong>No CC1101 response:</strong> verify 3.3 V power, common ground, SPI wiring,
          and that the script&rsquo;s CS pin matches your wiring.
        </li>
        <li>
          <strong>Frequency does not show 433.92 MHz:</strong> click <strong>Init TX</strong>,
          then click <strong>Initialize &amp; Read</strong> again.
        </li>
        <li>
          <strong>Carrier button has no effect:</strong> confirm GDO0 is wired to the selected
          GDO0 pin, for example GPIO2.
        </li>
        <li>
          <strong>Windows app is connected but script fails:</strong> confirm the board is running
          EMWaver firmware and appears connected in the Device view.
        </li>
      </ul>
    </>
  );
}
