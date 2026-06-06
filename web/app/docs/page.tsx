import Link from "next/link";

export default function DocsIndex() {
  return (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--sky)]">
        Documentation
      </div>
      <h1>Start with the product, not the toolchain.</h1>
      <p>
        EMWaver turns your phone or computer into the working surface for hardware control.
        Plug in a supported board, open the app, and start interacting with peripherals,
        signals, and scripts without firmware builds or IDE setup.
      </p>

      <h2>Quick start</h2>
      <ol>
        <li>
          <strong>Get a supported board</strong> — start with an ESP32-family dev board (ESP32,
          ESP32-S2, or ESP32-S3) or open the EMWaver hardware lineup and build files.
        </li>
        <li>
          <strong>Install the app</strong> — use the native app where it fits: iOS, Android, or macOS.
        </li>
        <li>
          <strong>Flash fixed firmware</strong> — use the bundled EMWaver firmware image for your
          board class (ESP32, ESP32-S2, ESP32-S3, or STM32F042). No user build loop.
        </li>
        <li>
          <strong>Run or generate a script</strong> — use built-in examples, write your own
          JSX-based <code>.js</code> script, or let the Agent assemble the flow.
        </li>
      </ol>

      <h2>What you can do</h2>
      <ul>
        <li>
          <strong>Infrared and signal work</strong> — capture and replay remote signals, inspect
          waveforms, zoom through samples, and retransmit from supported IR-capable boards.
        </li>
        <li>
          <strong>Buses and peripherals</strong> — drive SPI, I2C, UART, ADC, PWM, and GPIO from
          scripts to talk to sensors, displays, motor drivers, RFID modules, and board-level interfaces.
        </li>
        <li>
          <strong>Sub-GHz and RFID</strong> — work with CC1101-based radio setups and MFRC522-style
          RFID modules without leaving the same scripting model or app surface.
        </li>
        <li>
          <strong>Agent-assisted flows</strong> — ask the Agent to generate scripts, build control
          panels, run on real hardware, and iterate on the result from the same workspace.
        </li>
      </ul>

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
          <strong>Choose hardware</strong> from the <Link href="/build">build catalog</Link> or start with a supported
          ESP32-family dev board (ESP32, ESP32-S2, or ESP32-S3). Purpose-built hardware is also available in the{" "}
          <a href="https://github.com/continualmi/emwaver-shield" target="_blank" rel="noreferrer">
            EMWaver Shield repository
          </a>
          .
        </li>
        <li>
          <strong>Install the app</strong> through the{" "}
          <Link href="/docs/install">App Store, Google Play internal test, Android APK, macOS DMG, or Windows download</Link>.
        </li>
        <li>
          <strong>Flash the fixed EMWaver firmware</strong> if your board is not already pre-flashed. Use the bundled target image for your board class (ESP32, ESP32-S2, ESP32-S3, or STM32F042) rather than building firmware manually.
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
      <div className="mt-4 overflow-hidden rounded-2xl border border-[color:var(--line)]">
        {NEXT_LINKS.map((link, i) => (
          <Link
            key={link.href}
            href={link.href}
            className={`group flex items-center justify-between gap-4 px-5 py-4 no-underline transition hover:bg-[color:var(--surface-2)]${
              i > 0 ? " border-t border-[color:var(--line)]" : ""
            }`}
          >
            <div>
              <div className="text-base font-semibold text-[color:var(--ink)]">{link.title}</div>
              <div className="mt-0.5 text-sm text-[color:var(--ink-dim)]">{link.desc}</div>
            </div>
            <span className="shrink-0 text-sm font-medium text-[color:var(--ink-dim)] transition group-hover:translate-x-0.5 group-hover:text-[color:var(--ink)]">
              →
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}

const NEXT_LINKS = [
  {
    href: "/docs/scripts",
    title: "Learn the scripting model",
    desc: "JavaScript scripts, JSX-style UI syntax, imported device modules, and built-in examples.",
  },
  {
    href: "/docs/hardware",
    title: "Browse supported boards and repos",
    desc: "Board families, pinout details, open hardware files, and current build resources.",
  },
  {
    href: "/docs/tutorials",
    title: "Follow step-by-step hardware walkthroughs",
    desc: "Windows ESP32-family firmware flashing, CC1101 433 MHz setup, and practical script-driven hardware tests.",
  },
  {
    href: "/docs/community",
    title: "Get support and discuss builds",
    desc: "Join Continual Society on Discord for troubleshooting, ideas, and EMWaver discussion.",
  },
];
