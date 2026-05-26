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
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Link
          href="/docs/tutorials/windows-flashing"
          className="group flex flex-col gap-2 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 no-underline transition hover:bg-[color:var(--surface-2)]"
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--sky)]">
            Windows
          </div>
          <div className="text-lg font-semibold text-[color:var(--ink)]">
            Flash ESP32 firmware on Windows
          </div>
          <p className="text-sm leading-6 text-[color:var(--ink-dim)]">
            Walk through installing the Windows app, putting an ESP32-family dev board into
            bootloader mode, and flashing the managed EMWaver firmware — no manual toolchain required.
          </p>
          <div className="mt-1 text-sm font-semibold text-[color:var(--ink-dim)] transition group-hover:text-[color:var(--ink)]">
            Read tutorial →
          </div>
        </Link>
        <Link
          href="/docs/tutorials/windows-cc1101"
          className="group flex flex-col gap-2 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 no-underline transition hover:bg-[color:var(--surface-2)]"
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--aqua)]">
            Windows
          </div>
          <div className="text-lg font-semibold text-[color:var(--ink)]">
            Set up a CC1101 on Windows (433 MHz)
          </div>
          <p className="text-sm leading-6 text-[color:var(--ink-dim)]">
            Wire a CC1101 radio module to your ESP32-family board, open the built-in <code>cc1101.js</code>{" "}
            script, and transmit a basic 433 MHz ASK/OOK wave — all from the Windows app.
          </p>
          <div className="mt-1 text-sm font-semibold text-[color:var(--ink-dim)] transition group-hover:text-[color:var(--ink)]">
            Read tutorial →
          </div>
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
