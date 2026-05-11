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
    body: "The optional Agent can write, explain, debug, and improve .emw scripts while the open local hardware path remains useful on its own.",
  },
];

const comparisonRows = [
  ["Interface", "Full host screen", "128x64 monochrome", "External serial monitor or add-on display"],
  ["Storage", "Local host filesystem", "SD card", "Limited board flash unless you add storage"],
  ["AI workflow", "Optional Agent-assisted scripts", "None built in", "External tools only"],
  ["Development", "Instant .emw scripts", "Firmware build/flash for deeper changes", "Sketch compile/upload loop"],
  ["Hardware model", "Multiple supported boards", "Single handheld device", "Many boards, fragmented workflows"],
  ["Core access", "Account-free local control", "Device-local", "Account-free local control"],
];

const gettingStarted = [
  {
    step: "1",
    title: "Pick a supported board",
    body: "Start with an ESP32-S3 class target or an EMWaver STM32 build from the catalog.",
    href: "/emwaver/build",
    cta: "Open Build",
  },
  {
    step: "2",
    title: "Install the app",
    body: "Use the native app for your platform and let EMWaver manage the board setup where practical.",
    href: "/emwaver/install",
    cta: "Install",
  },
  {
    step: "3",
    title: "Run scripts",
    body: "Explore GPIO, buses, sensors, IR, RFID, and module workflows with local .emw scripts.",
    href: "/emwaver/scripts",
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
                Plug in, run local .emw scripts, and explore real electronics without
                accounts, cloud activation, or firmware toolchains.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/emwaver/build"
                  className="inline-flex items-center justify-center rounded-xl bg-[color:var(--aqua)] px-6 py-3 text-sm font-semibold text-slate-950 transition hover:opacity-90"
                >
                  Build EMWaver
                </Link>
                <Link
                  href="/emwaver/scripts"
                  className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-6 py-3 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface-2)]"
                >
                  Browse scripts
                </Link>
              </div>
            </div>

            <div className="mt-12 max-w-5xl overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-3 shadow-xl shadow-black/20">
              <Image
                src="/emwaver/banner.jpeg"
                alt="EMWaver platform across phone, desktop, and supported boards"
                width={1600}
                height={800}
                priority
                unoptimized
                className="h-auto w-full rounded-xl object-cover"
              />
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
                  src="/emwaver/landing3.png"
                  alt="EMWaver connected to a laptop"
                  width={1024}
                  height={768}
                  unoptimized
                  className="h-auto w-full object-cover"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Image
                  src="/emwaver/landing2.png"
                  alt="EMWaver close-up"
                  width={512}
                  height={384}
                  unoptimized
                  className="h-36 w-full rounded-2xl border border-[color:var(--line)] object-cover"
                />
                <Image
                  src="/emwaver/landing1.jpeg"
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
          <div className="grid gap-10 md:grid-cols-[0.9fr_1.1fr] md:items-start">
            <div>
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
            <div className="overflow-x-auto rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface-3)]">
              <table className="min-w-[760px] w-full text-left text-sm">
                <thead className="bg-[color:var(--table-header-bg)]">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-[color:var(--ink)]" />
                    <th className="px-4 py-3 font-semibold text-[color:var(--aqua)]">
                      EMWaver
                    </th>
                    <th className="px-4 py-3 font-semibold text-[color:var(--ink-dim)]">
                      Flipper Zero
                    </th>
                    <th className="px-4 py-3 font-semibold text-[color:var(--ink-dim)]">
                      Arduino
                    </th>
                  </tr>
                </thead>
                <tbody className="text-[color:var(--ink-dim)]">
                  {comparisonRows.map(([feature, emwaver, flipper, arduino]) => (
                    <tr key={feature} className="border-t border-[color:var(--table-border)]">
                      <td className="px-4 py-3 font-medium text-[color:var(--ink)]">
                        {feature}
                      </td>
                      <td className="px-4 py-3 text-[color:var(--aqua)]">{emwaver}</td>
                      <td className="px-4 py-3">{flipper}</td>
                      <td className="px-4 py-3">{arduino}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-14">
          <div className="grid gap-10 md:grid-cols-[1.05fr_0.95fr] md:items-start">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--sky)]">
                AI-assisted hardware
              </div>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-4xl">
                An Agent that can write, run, and improve scripts.
              </h2>
              <p className="mt-4 max-w-xl text-[15px] leading-7 text-[color:var(--ink-dim)]">
                The Agent product direction is paid API usage, not a cloud gate for
                local hardware. Apps collect local script, device, UI, and error
                context only when you choose to ask for help.
              </p>
            </div>
            <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface-3)] p-5">
              <div className="flex items-center justify-between gap-4 text-xs font-semibold text-[color:var(--ink-dim)]">
                <span>Agent workflow</span>
                <span>prompt to script to test</span>
              </div>
              <div className="mt-4 space-y-3 font-mono text-[12px] leading-6 text-[color:var(--ink)]">
                {[
                  ["You", "Build a UI for this RC522 module. Read cards and show UID."],
                  ["Agent", "Writes the SPI setup, creates the controls, runs the script, reads the result, then tightens the flow."],
                  ["You", "Capture this IR remote signal and make a replay button."],
                  ["Agent", "Configures capture, saves the waveform locally, and generates a one-tap retransmit UI."],
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
