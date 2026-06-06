import Link from "next/link";

export default function TutorialsIndex() {
  return (
    <>
      <h1>Tutorials</h1>
      <p>
        Step-by-step walkthroughs for setting up EMWaver on specific platforms, connecting
        hardware modules, and running your first scripts - all without digging through toolchains
        or IDE setup.
      </p>

      <h2>Windows</h2>
      <div className="mt-3 overflow-hidden rounded-2xl border border-[color:var(--line)]">
        <Link
          href="/docs/tutorials/windows-flashing"
          className="group flex items-center justify-between gap-4 px-5 py-4 no-underline transition hover:bg-[color:var(--surface-2)]"
        >
          <div>
            <div className="text-base font-semibold text-[color:var(--ink)]">
              Flash ESP32 firmware on Windows
            </div>
            <div className="mt-0.5 text-sm text-[color:var(--ink-dim)]">
              Install the Windows app, put an ESP32-family dev board into bootloader mode, and flash
              the managed EMWaver firmware — no manual toolchain required.
            </div>
          </div>
          <span className="shrink-0 text-sm font-medium text-[color:var(--ink-dim)] transition group-hover:translate-x-0.5 group-hover:text-[color:var(--ink)]">
            →
          </span>
        </Link>
        <Link
          href="/docs/tutorials/windows-cc1101"
          className="group flex items-center justify-between gap-4 border-t border-[color:var(--line)] px-5 py-4 no-underline transition hover:bg-[color:var(--surface-2)]"
        >
          <div>
            <div className="text-base font-semibold text-[color:var(--ink)]">
              Set up a CC1101 on Windows (433 MHz)
            </div>
            <div className="mt-0.5 text-sm text-[color:var(--ink-dim)]">
              Wire a CC1101 radio module to your ESP32-family board, open the built-in{" "}
              <code>cc1101.js</code> script, and transmit a basic 433 MHz ASK/OOK wave.
            </div>
          </div>
          <span className="shrink-0 text-sm font-medium text-[color:var(--ink-dim)] transition group-hover:translate-x-0.5 group-hover:text-[color:var(--ink)]">
            →
          </span>
        </Link>
      </div>

      <h2>More coming</h2>
      <p>
        Additional tutorials for macOS firmware flashing, iOS/Android mobile setup, RFID module
        walkthroughs, and I2C/SPI peripheral scripts are on the way. Check back or{" "}
        <Link href="/docs/community">join the community</Link> for early previews.
      </p>
    </>
  );
}
