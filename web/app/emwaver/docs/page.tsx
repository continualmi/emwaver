import Link from "next/link";

export default function DocsIndex() {
  return (
    <>
      <section className="rounded-[2rem] border border-[color:var(--line)] bg-[color:var(--glass)] px-6 py-7 shadow-[0_24px_70px_var(--shadow)] md:px-8 md:py-9">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--sky)]">
          Documentation
        </div>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">
          Start with the product, not the toolchain.
        </h1>
        <p className="mt-4 max-w-3xl text-base leading-8 text-[color:var(--ink-dim)]">
          EMWaver turns your phone or computer into the working surface for hardware control.
          Plug in a supported board, open the app, and start interacting with peripherals,
          signals, and scripts without firmware builds or IDE setup.
        </p>

        <div className="mt-8 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--aqua)]">
              Step 1
            </div>
            <div className="mt-2 text-base font-semibold text-[color:var(--ink)]">Get a supported board</div>
            <p className="mt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
              Start with an ESP32-S3 dev board or open the EMWaver hardware lineup and build files.
            </p>
          </div>
          <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--sky)]">
              Step 2
            </div>
            <div className="mt-2 text-base font-semibold text-[color:var(--ink)]">Install the app</div>
            <p className="mt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
              Use the native app where it fits — iOS, Android, or macOS.
            </p>
          </div>
          <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--aqua)]">
              Step 3
            </div>
            <div className="mt-2 text-base font-semibold text-[color:var(--ink)]">Flash fixed firmware</div>
            <p className="mt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
              Use the bundled ESP32-S3 or STM32F042 EMWaver firmware image. No user build loop.
            </p>
          </div>
          <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--copper)]">
              Step 4
            </div>
            <div className="mt-2 text-base font-semibold text-[color:var(--ink)]">Run or generate a script</div>
            <p className="mt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
              Use built-in examples, write your own JSX-based <code>.js</code> script, or let the Agent assemble the flow.
            </p>
          </div>
        </div>
      </section>

      <h2>What you can do</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
          <h3 className="mt-0">Infrared and signal work</h3>
          <p>
            Capture and replay remote signals, inspect waveforms, zoom through samples, and retransmit
            directly from supported IR-capable boards.
          </p>
        </div>
        <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
          <h3 className="mt-0">Buses and peripherals</h3>
          <p>
            Drive SPI, I2C, UART, ADC, PWM, and GPIO from scripts to talk to sensors, displays,
            motor drivers, RFID modules, and board-level interfaces.
          </p>
        </div>
        <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
          <h3 className="mt-0">Sub-GHz and RFID</h3>
          <p>
            Work with CC1101-based radio setups and MFRC522-style RFID modules without leaving the
            same scripting model or app surface.
          </p>
        </div>
        <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
          <h3 className="mt-0">Agent-assisted flows</h3>
          <p>
            Ask the Agent to generate scripts, build control panels, run on real hardware, and iterate
            on the result from the same workspace.
          </p>
        </div>
      </div>

      <h2>How it works</h2>
      <p>
        Everything runs through <strong>scripts</strong> using local JavaScript files that define
        both hardware logic and JSX UI in one place. When you run a script, the app renders controls, plots,
        and inputs directly on your device. Edit the file and run again for immediate feedback.
      </p>
      <p>
        The board handles the physical I/O. Your phone or computer handles rendering, storage, script
        execution, and local device transport.
      </p>
      <h2>Quick start details</h2>
      <ol>
        <li>
          <strong>Choose hardware</strong> from the <Link href="/emwaver/build">build catalog</Link> or start with a supported
          ESP32-S3 dev board. Purpose-built hardware is also available in the{" "}
          <a href="https://github.com/continualmi/emwaver-shield" target="_blank" rel="noreferrer">
            EMWaver Shield repository
          </a>
          .
        </li>
        <li>
          <strong>Install the app</strong> through the{" "}
          <Link href="/emwaver/docs/install">App Store, Google Play internal test, Android APK, macOS DMG, or Windows download</Link>.
        </li>
        <li>
          <strong>Flash the fixed EMWaver firmware</strong> if your board is not already pre-flashed. Use the bundled ESP32-S3 or STM32F042 target image rather than building firmware manually.
        </li>
        <li>
          <strong>Plug in locally</strong>. EMWaver runs supported scripts directly through the native app and connected board.
        </li>
        <li>
          <strong>Open a script</strong> such as <code>sampler.js</code>, <code>cc1101.js</code>, or <code>rfid.js</code>,
          then adapt it or generate a new one.
        </li>
      </ol>

      <h2>Apps</h2>
      <ul>
        <li><strong>iOS</strong> on the App Store</li>
        <li><strong>Android</strong> through the Google Play internal test or direct APK download</li>
        <li><strong>macOS</strong> direct DMG download for development and advanced use</li>
        <li><strong>Windows</strong> EXE installer and ZIP downloads</li>
        <li><strong>Linux</strong> native app in progress</li>
      </ul>

      <h2>What to read next</h2>
      <div className="mt-4 grid gap-3">
        <Link
          href="/emwaver/docs/scripts"
          className="group flex items-start justify-between gap-4 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] px-5 py-4 no-underline transition hover:bg-[color:var(--surface-2)]"
        >
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--copper)]">Scripts</div>
            <div className="mt-1 text-lg font-semibold text-[color:var(--ink)]">Learn the scripting model</div>
            <div className="mt-1 text-sm text-[color:var(--ink-dim)]">
              JavaScript scripts, JSX-style UI syntax, imported device modules, and built-in examples.
            </div>
          </div>
          <div className="mt-1 text-sm font-semibold text-[color:var(--ink-dim)] transition group-hover:text-[color:var(--ink)]">
            Open
          </div>
        </Link>
        <Link
          href="/emwaver/docs/hardware"
          className="group flex items-start justify-between gap-4 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] px-5 py-4 no-underline transition hover:bg-[color:var(--surface-2)]"
        >
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--aqua)]">Hardware</div>
            <div className="mt-1 text-lg font-semibold text-[color:var(--ink)]">Browse supported boards and repos</div>
            <div className="mt-1 text-sm text-[color:var(--ink-dim)]">
              Board families, pinout details, open hardware files, and current build resources.
            </div>
          </div>
          <div className="mt-1 text-sm font-semibold text-[color:var(--ink-dim)] transition group-hover:text-[color:var(--ink)]">
            Open
          </div>
        </Link>
        <Link
          href="/emwaver/docs/community"
          className="group flex items-start justify-between gap-4 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] px-5 py-4 no-underline transition hover:bg-[color:var(--surface-2)]"
        >
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--sky)]">Community</div>
            <div className="mt-1 text-lg font-semibold text-[color:var(--ink)]">Get support and discuss builds</div>
            <div className="mt-1 text-sm text-[color:var(--ink-dim)]">
              Join Continual Society on Discord for troubleshooting, ideas, and EMWaver discussion.
            </div>
          </div>
          <div className="mt-1 text-sm font-semibold text-[color:var(--ink-dim)] transition group-hover:text-[color:var(--ink)]">
            Open
          </div>
        </Link>
      </div>
    </>
  );
}
