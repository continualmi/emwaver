import Link from "next/link";

const BOARDS = [
  {
    name: "EMWaver Shield",
    slug: "emwaver-shield",
    mcu: "STM32F042",
    repo: "https://github.com/continualmi/emwaver-shield",
    status: "Available",
    description:
      "Purpose-built EMWaver board with male USB-C, IR TX/RX, SPI module headers (CC1101-compatible), and I2C/UART breakout.",
  },
  {
    name: "ESP32-S3 Dev Board",
    slug: "esp32s3-devboard",
    mcu: "ESP32-S3",
    repo: null,
    status: "Supported",
    description:
      "Any off-the-shelf ESP32-S3 dev board works as an EMWaver device. No custom hardware needed — just plug in and activate through the app.",
  },
];

export default function HardwareDocPage() {
  return (
    <>
      <h1>Boards &amp; repos</h1>
      <p>
        EMWaver supports multiple MCU boards. Each board has an open-source hardware repo on
        GitHub with KiCad files, BOM, Gerbers, and a README explaining how to build it.
      </p>
      <p>
        Users bring their own supported board — build one from our repos or use a compatible
        off-the-shelf board. The app handles firmware and activation for each supported target.
      </p>

      <h2>Supported boards</h2>
      <div className="mt-4 grid gap-4">
        {BOARDS.map((board) => (
          <div
            key={board.slug}
            className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-[color:var(--ink)]">{board.name}</div>
                <div className="mt-1 text-xs text-[color:var(--ink-dim)]">{board.mcu}</div>
              </div>
              <div
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  board.status === "Available" || board.status === "Supported"
                    ? "bg-[rgba(78,231,199,0.12)] text-[color:var(--aqua)]"
                    : "bg-[color:var(--surface-2)] text-[color:var(--ink-dim)]"
                }`}
              >
                {board.status}
              </div>
            </div>
            <p className="mt-3 text-sm leading-6 text-[color:var(--ink-dim)]">
              {board.description}
            </p>
            {board.repo ? (
              <a
                href={board.repo}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] px-4 py-2 text-sm font-medium text-[color:var(--ink)] no-underline hover:bg-[color:var(--surface-2)]"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                </svg>
                View on GitHub
              </a>
            ) : (
              <div className="mt-3 text-xs text-[color:var(--ink-dim)]">
                Repo will be published when ready.
              </div>
            )}
          </div>
        ))}
      </div>

      <h2>How hardware repos work</h2>
      <ul>
        <li>Each repo contains KiCad project files, schematics, PCB layout, and Gerbers.</li>
        <li>A README in each repo explains the full build process.</li>
        <li>
          You can order PCBs from any fab (JLCPCB, PCBWay, etc.) using the provided Gerber files.
        </li>
        <li>
          BOM and assembly instructions are included for hand-soldering or PCBA ordering.
        </li>
      </ul>

      <h2>Pinout reference</h2>
      <p>
        For GPIO numbering, headers, and pin assignments on the EMWaver Shield, see the{" "}
        <Link href="/docs/hardware/pinout">pinout reference</Link>.
      </p>
    </>
  );
}
