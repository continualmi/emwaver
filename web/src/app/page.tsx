import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

export default function HomePage() {
  return (
    <div className="relative min-h-dvh overflow-x-clip">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <img src="/2015_upscale.jpg" alt="" className="h-full w-full object-cover opacity-[0.72]" />
        <div className="absolute inset-0 bg-[radial-gradient(900px_600px_at_15%_0%,rgba(255,255,255,0.10),transparent_60%),radial-gradient(900px_600px_at_85%_10%,rgba(78,231,199,0.10),transparent_62%)]" />
      </div>

      <SiteHeader />

      <main>
        {/* ─── HERO ─── */}
        <section className="mx-auto max-w-6xl px-5 pt-16 pb-12">
          <div className="text-center">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-1.5 text-xs text-[color:var(--ink-dim)]">
              <span className="inline-block h-2 w-2 rounded-full bg-[color:var(--aqua)]" />
              The future of electronics development
            </div>

            <h1 className="mx-auto mt-6 max-w-4xl text-4xl leading-[1.05] font-semibold tracking-tight text-[color:var(--ink)] md:text-6xl lg:text-7xl">
              Electronics development,{" "}
              <span className="bg-gradient-to-r from-[color:var(--aqua)] to-[color:var(--sky)] bg-clip-text text-transparent">
                reimagined.
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-[16px] leading-8 text-[color:var(--ink-dim)]">
              EMWaver is a tiny USB device that turns any phone, laptop, or Raspberry Pi into a
              full-power electronics lab. No firmware flashing, no toolchains, no limitations.
              Just plug in and go.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/build"
                className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-6 py-3.5 text-sm font-semibold text-[color:var(--paper)] shadow-[0_18px_40px_var(--shadow)] hover:opacity-95"
              >
                Build EMWaver
              </Link>
              <Link
                href="/scripts"
                className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-6 py-3.5 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                Browse scripts
              </Link>
            </div>
          </div>

          {/* Hero image: device + phone */}
          <div className="mx-auto mt-12 max-w-4xl">
            <div className="relative overflow-hidden rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.06)] backdrop-blur-md shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
              <div className="absolute inset-0 bg-[radial-gradient(600px_300px_at_30%_10%,rgba(78,231,199,0.18),transparent_55%),radial-gradient(600px_400px_at_90%_40%,rgba(91,192,255,0.14),transparent_58%)]" />
              <div className="relative p-6">
                <img
                  src="/banner.jpeg"
                  alt="EMWaver platform banner showing Android, iOS, Linux, Mac, and Windows"
                  className="h-auto w-full rounded-2xl border border-[color:var(--line)] object-cover"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ─── PLATFORM PILLARS (3 cards) ─── */}
        <section className="mx-auto max-w-6xl px-5 pb-14">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.06)] p-6 backdrop-blur-md">
              <div className="text-xs font-semibold text-[color:var(--aqua)]">Host-powered</div>
              <div className="pt-3 text-lg font-semibold text-[color:var(--ink)]">Your phone is the computer</div>
              <div className="pt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
                EMWaver extracts power, compute, UI, storage, and connectivity from the host it&apos;s plugged into. No on-device screen or buttons needed — your phone or laptop <em>is</em> the interface.
              </div>
            </div>
            <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.06)] p-6 backdrop-blur-md">
              <div className="text-xs font-semibold text-[color:var(--sky)]">AI-first</div>
              <div className="pt-3 text-lg font-semibold text-[color:var(--ink)]">Agents that build and test</div>
              <div className="pt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
                AI agents write scripts, generate UI, and interact with the interfaces they create — testing autonomously. Full chip exploits in minutes, not days.
              </div>
            </div>
            <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.06)] p-6 backdrop-blur-md">
              <div className="text-xs font-semibold text-[color:var(--copper)]">Plug and play</div>
              <div className="pt-3 text-lg font-semibold text-[color:var(--ink)]">Zero prerequisites</div>
              <div className="pt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
                No toolchains, no firmware flashing, no IDE. Install the app, plug in the device. Start capturing and cloning IR signals in seconds.
              </div>
            </div>
          </div>
        </section>

        {/* ─── CTA ─── */}
        <section className="mx-auto max-w-6xl px-5 pb-16">
          <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-6 md:p-10 backdrop-blur-md">
            <div className="flex items-end justify-between gap-6">
              <div>
                <div className="text-xs font-semibold tracking-wide text-[color:var(--aqua)]">
                  Get started
                </div>
                <h2 className="pt-2 text-2xl font-semibold tracking-tight text-[color:var(--ink)] md:text-3xl">
                  Ready to reimagine electronics?
                </h2>
                <p className="pt-2 max-w-2xl text-[15px] leading-7 text-[color:var(--ink-dim)]">
                  Build a supported board, install the app, and start exploring. It&apos;s that simple.
                </p>
              </div>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <Link
                href="/build"
                className="group rounded-2xl border border-[color:var(--line)] bg-[rgba(78,231,199,0.08)] p-5 hover:bg-[rgba(78,231,199,0.12)]"
              >
                <div className="text-xs font-semibold text-[color:var(--aqua)]">Step 1</div>
                <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
                  Open Build
                </div>
                <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                  Pick a supported board and open the build files.
                </div>
              </Link>

              <Link
                href="/install"
                className="group rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
              >
                <div className="text-xs font-semibold text-[color:var(--sky)]">Step 2</div>
                <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
                  Install the app
                </div>
                <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                  Available on App Store, Play Store, and more.
                </div>
              </Link>

              <Link
                href="/scripts"
                className="group rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
              >
                <div className="text-xs font-semibold text-[color:var(--copper)]">Step 3</div>
                <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
                  Start hacking
                </div>
                <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                  Run scripts, plug in modules, explore hardware.
                </div>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
