import Link from "next/link";

export default function DocsIndex() {
  return (
    <>
      <h1>EMWaver Documentation</h1>
      <p>
        EMWaver is a USB device that turns your phone or computer into a full electronics lab.
        Plug it in, open the app, and start interacting with hardware — capture and replay IR
        signals, talk to SPI/I2C/UART peripherals, control GPIO, read sensors, and more. No
        toolchains, no firmware builds, no IDE required.
      </p>

      <h2>What you can do</h2>
      <ul>
        <li>
          <strong>Infrared</strong> — the EMWaver Shield has a built-in IR receiver and
          transmitter. Capture signals from any remote, analyze the waveform, and replay it.
          Works out of the box.
        </li>
        <li>
          <strong>Sub-GHz radio</strong> — plug in a CC1101 module and control it from a
          script. Read registers, configure RF parameters, transmit and receive packets.
        </li>
        <li>
          <strong>RFID</strong> — plug in an MFRC522 module and scan cards, read UIDs,
          read/write blocks.
        </li>
        <li>
          <strong>Sensors and peripherals</strong> — use SPI, I2C, UART, ADC, and PWM to talk
          to anything you connect. Temperature sensors, accelerometers, displays, motor
          controllers — if it has a bus interface, you can drive it from a script.
        </li>
        <li>
          <strong>GPIO</strong> — direct digital I/O for LEDs, relays, buttons, or any simple
          on/off control.
        </li>
        <li>
          <strong>Signal capture</strong> — high-speed bit sampling with a built-in waveform
          plot that supports pan, zoom, and retransmit.
        </li>
      </ul>

      <h2>How it works</h2>
      <p>
        Everything happens through <strong>scripts</strong> — small <code>.emw</code> files
        (JavaScript) that define both hardware logic and UI in one file. When you run a script,
        the app renders native buttons, sliders, plots, and controls on your device. Edit the
        script, run it again — instant results, no compile or flash step.
      </p>
      <p>
        The board handles I/O (reading pins, driving SPI, sampling signals). Your phone or
        computer handles everything else — rendering the UI, storing data, running the script
        engine, and connecting to the cloud.
      </p>

      <h2>Quick start</h2>
      <ol>
        <li>
          <strong>Get a board</strong> — build an{" "}
          <a href="https://github.com/continualmi/emwaver-shield" target="_blank" rel="noreferrer">
            EMWaver Shield
          </a>{" "}
          from the open-source hardware files, or use an off-the-shelf ESP32-S3 dev board.
        </li>
        <li>
          <strong>Install the app</strong> — available on the{" "}
          <Link href="/docs/install">App Store, Google Play, and Microsoft Store</Link>.
        </li>
        <li>
          <strong>Plug in and activate</strong> — connect via USB, sign in, and the app handles
          firmware and device activation automatically.
        </li>
        <li>
          <strong>Run a script</strong> — open the Scripts tab and run one of the built-in
          scripts (<code>sampler.emw</code>, <code>cc1101.emw</code>, <code>rfid.emw</code>,
          etc.) or write your own.
        </li>
      </ol>

      <h2>AI agent</h2>
      <p>
        EMWaver has a built-in AI agent that can write scripts, generate UI, run them on
        real hardware, interact with the controls it created, and iterate. Describe what you
        want — &quot;build a dashboard for this I2C sensor&quot; — and the agent builds and
        tests it autonomously.
      </p>

      <h2>Apps</h2>
      <p>
        Native apps on every platform. Same scripts, same experience:
      </p>
      <ul>
        <li><strong>macOS</strong> and <strong>iOS</strong> — App Store</li>
        <li><strong>Android</strong> — Google Play</li>
        <li><strong>Windows</strong> — Microsoft Store</li>
      </ul>

      <h2>What to read next</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Link
          href="/docs/scripts"
          className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
        >
          <div className="text-xs font-semibold text-[color:var(--copper)]">Scripts</div>
          <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">Scripting guide</div>
          <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
            How scripts work, device APIs, UI widgets, built-in scripts.
          </div>
        </Link>
        <Link
          href="/docs/hardware"
          className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
        >
          <div className="text-xs font-semibold text-[color:var(--aqua)]">Hardware</div>
          <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
            Boards &amp; repos
          </div>
          <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
            Supported boards, open-source hardware files, pinout.
          </div>
        </Link>
      </div>
    </>
  );
}
