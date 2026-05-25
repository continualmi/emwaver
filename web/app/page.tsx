import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "@/components/emwaver/SiteHeader";

const capabilityCards = [
  {
    label: "Local-first",
    title: "Your computer stays in charge",
    body: "Run scripts from the native apps without EMWaver accounts, cloud activation, or hosted relay dependencies.",
  },
  {
    label: "Managed firmware",
    title: "No MCU toolchain loop",
    body: "Supported boards get platform-managed firmware targets so the workflow stays script-first instead of compile, flash, debug, repeat.",
  },
  {
    label: "Agent-ready",
    title: "AI helps when you ask",
    body: "The optional Agent can write, explain, debug, and improve local JSX-based JavaScript scripts while the open hardware path remains useful on its own.",
  },
];

const comparisonRows = [
  ["Interface", "Full host screen", "128x64 monochrome", "External serial monitor or add-on display"],
  ["Storage", "Local host filesystem", "SD card", "Limited board flash unless you add storage"],
  ["AI workflow", "Optional Agent-assisted scripts", "None built in", "External tools only"],
  ["Development", "Instant local JavaScript scripts", "Firmware build/flash for deeper changes", "Sketch compile/upload loop"],
  ["Hardware model", "Multiple supported boards", "Single handheld device", "Many boards, fragmented workflows"],
  ["Core access", "Account-free local control", "Device-local", "Account-free local control"],
];

const trailer = {
  title: "EMWaver Trailer",
  href: "https://www.youtube.com/watch?v=6acoNgBqpe0",
  embedUrl: "https://www.youtube-nocookie.com/embed/6acoNgBqpe0?rel=0",
};

const gettingStarted = [
  {
    step: "1",
    title: "Pick a supported board",
    body: "Start with an ESP32-S3 class target or an EMWaver STM32 build from the catalog.",
    href: "/build",
    cta: "Open Build",
  },
  {
    step: "2",
    title: "Install the app",
    body: "Use the native app for your platform and let EMWaver manage the board setup where practical.",
    href: "/install",
    cta: "Install",
  },
  {
    step: "3",
    title: "Run scripts",
    body: "Explore GPIO, buses, sensors, IR, RFID, and module workflows with local JavaScript scripts.",
    href: "/scripts",
    cta: "Browse scripts",
  },
];

export default function HomePage() {
  return (
    <div className="min-h-dvh overflow-hidden">
      <SiteHeader />

      <main>
        <section className="relative isolate min-h-[calc(100svh-74px)] overflow-hidden px-5">
          <div className="relative z-10 mx-auto flex min-h-[calc(100svh-74px)] max-w-6xl flex-col justify-center pb-16 pt-14">
            <div className="max-w-4xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-1.5 text-xs font-semibold text-[color:var(--ink-dim)]">
                <span className="h-2 w-2 rounded-full bg-[color:var(--aqua)]" />
                Local-first electronics development
              </div>
              <h1 className="mt-6 max-w-4xl text-5xl font-semibold leading-[1.02] tracking-tight text-[color:var(--ink)] md:text-7xl">
                Electronics development,{" "}
                <span className="text-[color:var(--aqua)]">reimagined.</span>
              </h1>
              <p className="mt-6 max-w-2xl text-[17px] leading-8 text-[color:var(--ink-dim)]">
                EMWaver turns supported MCU boards into a scriptable hardware lab.
                Plug in, run local JavaScript scripts, and explore real electronics without
                accounts, cloud activation, or firmware toolchains.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/build"
                  className="inline-flex items-center justify-center rounded-xl bg-[color:var(--aqua)] px-6 py-3 text-sm font-semibold text-slate-950 transition hover:opacity-90"
                >
                  Build EMWaver
                </Link>
                <a
                  href="#trailer"
                  className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-6 py-3 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface-2)]"
                >
                  Watch trailer
                </a>
                <Link
                  href="/scripts"
                  className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-transparent px-6 py-3 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface-2)]"
                >
                  Browse scripts
                </Link>
              </div>
            </div>

            <div className="mt-12 max-w-5xl overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-3 shadow-xl shadow-black/20">
              <Image
                src="/banner.jpeg"
                alt="EMWaver on phones and supported boards"
                width={1600}
                height={800}
                priority
                unoptimized
                className="h-auto w-full rounded-xl object-cover"
              />
            </div>
          </div>
        </section>

        <section id="trailer" className="mx-auto max-w-6xl px-5 py-14">
          <div className="grid gap-6 rounded-[2rem] border border-[color:var(--line)] bg-[color:var(--surface)] p-5 shadow-[0_24px_70px_var(--shadow)] md:grid-cols-[0.85fr_1.15fr] md:items-center md:p-6">
            <div className="px-1 py-2 md:px-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--aqua)]">
                Trailer
              </div>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-4xl">
                See EMWaver in motion.
              </h2>
              <p className="mt-4 text-[15px] leading-7 text-[color:var(--ink-dim)]">
                The launch trailer is the fastest way to understand EMWaver: a phone-first,
                script-first electronics platform that keeps local hardware control open and immediate.
              </p>
              <a
                href={trailer.href}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-5 py-3 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface-3)]"
              >
                Open on YouTube
              </a>
            </div>
            <div className="overflow-hidden rounded-[1.5rem] border border-[color:var(--line)] bg-black/30 shadow-xl shadow-black/20">
              <div className="aspect-video">
                <iframe
                  src={trailer.embedUrl}
                  title={trailer.title}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-14">
          <div className="grid gap-4 md:grid-cols-3">
            {capabilityCards.map((card) => (
              <article
                key={card.title}
                className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface-3)] p-6"
              >
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--aqua)]">
                  {card.label}
                </div>
                <h2 className="pt-3 text-lg font-semibold text-[color:var(--ink)]">
                  {card.title}
                </h2>
                <p className="pt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
                  {card.body}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-14">
          <div className="grid gap-10 md:grid-cols-2 md:items-center">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--sky)]">
                Managed device platform
              </div>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-4xl">
                Stop being limited by your MCU.
              </h2>
              <p className="mt-4 text-[15px] leading-7 text-[color:var(--ink-dim)]">
                EMWaver splits the system where it belongs. Boards handle the
                timing-sensitive hardware edge, while the host app owns UI,
                storage, orchestration, scripting, and optional Agent context.
              </p>
              <div className="mt-6 grid gap-3 text-sm text-[color:var(--ink-dim)]">
                {[
                  "Full-screen native UI instead of tiny embedded displays.",
                  "Host storage for captures, scripts, and generated artifacts.",
                  "USB-first control, with BLE and Wi-Fi available for boards designed around them.",
                ].map((item) => (
                  <div key={item} className="flex gap-3">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[color:var(--aqua)]" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid gap-4">
              <div className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface-3)]">
                <Image
                  src="/landing3.png"
                  alt="EMWaver connected to a laptop"
                  width={1024}
                  height={768}
                  unoptimized
                  className="h-auto w-full object-cover"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Image
                  src="/landing2.png"
                  alt="EMWaver close-up"
                  width={512}
                  height={384}
                  unoptimized
                  className="h-36 w-full rounded-2xl border border-[color:var(--line)] object-cover"
                />
                <Image
                  src="/landing1.jpeg"
                  alt="EMWaver plugged into a phone"
                  width={512}
                  height={384}
                  unoptimized
                  className="h-36 w-full rounded-2xl border border-[color:var(--line)] object-cover"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-14">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--copper)]">
              Different from handhelds and dev boards
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-4xl">
              Why EMWaver over Flipper Zero or Arduino?
            </h2>
            <p className="mt-4 text-[15px] leading-7 text-[color:var(--ink-dim)]">
              EMWaver is not a Flipper clone and not a conventional MCU board
              workflow. It uses the host for the things hosts are good at, then
              keeps hardware interaction scriptable and local.
            </p>
          </div>
          <div className="mt-8 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface-3)] p-3 md:p-4">
            <div className="grid gap-3 md:hidden">
              {comparisonRows.map(([feature, emwaver, flipper, arduino]) => (
                <article key={feature} className="rounded-xl border border-[color:var(--table-border)] bg-[color:var(--surface-2)] p-4">
                  <h3 className="font-semibold text-[color:var(--ink)]">{feature}</h3>
                  <dl className="mt-3 grid gap-2 text-sm leading-6">
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--aqua)]">EMWaver</dt>
                      <dd className="text-[color:var(--aqua)]">{emwaver}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-dim)]">Flipper Zero</dt>
                      <dd className="text-[color:var(--ink-dim)]">{flipper}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-dim)]">Arduino</dt>
                      <dd className="text-[color:var(--ink-dim)]">{arduino}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
            <table className="hidden w-full table-fixed text-left text-sm md:table">
              <colgroup>
                <col className="w-[18%]" />
                <col className="w-[30%]" />
                <col className="w-[26%]" />
                <col className="w-[26%]" />
              </colgroup>
              <thead className="bg-[color:var(--table-header-bg)]">
                <tr>
                  <th className="rounded-tl-xl px-4 py-3 font-semibold text-[color:var(--ink)]" />
                  <th className="px-4 py-3 font-semibold text-[color:var(--aqua)]">
                    EMWaver
                  </th>
                  <th className="px-4 py-3 font-semibold text-[color:var(--ink-dim)]">
                    Flipper Zero
                  </th>
                  <th className="rounded-tr-xl px-4 py-3 font-semibold text-[color:var(--ink-dim)]">
                    Arduino
                  </th>
                </tr>
              </thead>
              <tbody className="text-[color:var(--ink-dim)]">
                {comparisonRows.map(([feature, emwaver, flipper, arduino]) => (
                  <tr key={feature} className="border-t border-[color:var(--table-border)] align-top">
                    <td className="px-4 py-4 font-medium text-[color:var(--ink)]">
                      {feature}
                    </td>
                    <td className="px-4 py-4 text-[color:var(--aqua)]">{emwaver}</td>
                    <td className="px-4 py-4">{flipper}</td>
                    <td className="px-4 py-4">{arduino}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-14">
          <div className="grid gap-10 md:grid-cols-[1.05fr_0.95fr] md:items-start">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--sky)]">
                AI-assisted hardware
              </div>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-4xl">
                An Agent with hardware tools, not just chat.
              </h2>
              <p className="mt-4 max-w-xl text-[15px] leading-7 text-[color:var(--ink-dim)]">
                The Agent can help you hack on and interface with devices directly. It uses
                named hardware primitives like <code>spi_transfer</code>, <code>gpio_read</code>,
                <code>gpio_write</code>, and <code>analog_read</code>, then turns working flows into
                local <code>.js</code> scripts with UI controls, plots, logs, and buttons.
              </p>
            </div>
            <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface-3)] p-5">
              <div className="flex items-center justify-between gap-4 text-xs font-semibold text-[color:var(--ink-dim)]">
                <span>Agent tool loop</span>
                <span>tools to local UI scripts</span>
              </div>
              <div className="mt-4 space-y-3 font-mono text-[12px] leading-6 text-[color:var(--ink)]">
                {[
                  ["You", "Find this SPI sensor, read its ID register, and show me what responds."],
                  ["Agent", "Calls spi_transfer with candidate modes, toggles chip-select with gpio_write, and checks returned bytes."],
                  ["You", "Turn that into a reusable dashboard."],
                  ["Agent", "Writes a local .js script with buttons, live analog_read plots, gpio_read status, and a log viewer UI."],
                ].map(([speaker, text]) => (
                  <div
                    key={`${speaker}-${text}`}
                    className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4"
                  >
                    <div className="text-[color:var(--aqua)]">{speaker}</div>
                    <div>{text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-14">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--aqua)]">
            Get started
          </div>
          <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-4xl">
            Bring up a local electronics lab in three steps.
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {gettingStarted.map((item) => (
              <Link
                key={item.step}
                href={item.href}
                className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface-3)] p-6 transition hover:bg-[color:var(--surface-2)]"
              >
                <div className="text-xs font-semibold text-[color:var(--aqua)]">
                  Step {item.step}
                </div>
                <div className="pt-3 text-lg font-semibold text-[color:var(--ink)]">
                  {item.title}
                </div>
                <p className="pt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
                  {item.body}
                </p>
                <div className="pt-5 text-sm font-semibold text-[color:var(--sky)]">
                  {item.cta}
                </div>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
