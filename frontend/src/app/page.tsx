import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

export default function HomePage() {
  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <img
          src="/2015_upscale.jpg"
          alt=""
          className="h-full w-full object-cover opacity-[0.45]"
        />
        <div className="absolute inset-0 bg-[radial-gradient(1000px_600px_at_20%_0%,rgba(78,231,199,0.14),transparent_60%),radial-gradient(900px_600px_at_85%_20%,rgba(91,192,255,0.10),transparent_62%),linear-gradient(to_bottom,rgba(2,3,8,0.70),rgba(2,3,8,0.78))]" />
      </div>

      <SiteHeader />

      <main>
        <section className="mx-auto max-w-6xl px-5 pt-14 pb-10">
          <div className="grid items-start gap-10 md:grid-cols-2">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1 text-xs text-[color:var(--ink-dim)]">
                <span className="inline-block h-2 w-2 rounded-full bg-[color:var(--aqua)]" />
                Script-first hardware exploration
              </div>

              <h1 className="text-4xl leading-[1.02] font-semibold tracking-tight text-[color:var(--ink)] md:text-6xl">
                Hardware exploration,
                <br />
                built like software.
              </h1>

              <p className="max-w-xl text-[15px] leading-7 text-[color:var(--ink-dim)]">
                EMWaver is a script-centered hardware exploration platform built around a single USB device.
                You iterate fast, build real UI alongside experiments, and keep repeatable tools as scripts —
                without reflashing loops.
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/scripts"
                  className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-5 py-3 text-sm font-semibold text-[color:var(--paper)] shadow-[0_18px_40px_var(--shadow)] hover:opacity-95"
                >
                  Start with scripts
                </Link>
                <Link
                  href="/install"
                  className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-5 py-3 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
                >
                  Install
                </Link>
              </div>
            </div>

            <div className="space-y-4">
              <div className="relative overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
                <div className="absolute inset-0 bg-[radial-gradient(600px_300px_at_30%_10%,rgba(78,231,199,0.22),transparent_55%),radial-gradient(600px_400px_at_90%_40%,rgba(91,192,255,0.18),transparent_58%)]" />
                <div className="relative p-4">
                  <img
                    src="/banner.jpeg"
                    alt="EMWaver"
                    className="h-auto w-full rounded-xl border border-[color:var(--line)] object-cover"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="group relative overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)]">
                  <img
                    src="/landing1.jpeg"
                    alt="EMWaver in the field"
                    className="h-28 w-full object-cover transition duration-500 group-hover:scale-[1.03] md:h-32"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-black/0" />
                  <div className="absolute bottom-0 left-0 right-0 p-3 text-[11px] font-semibold tracking-wide text-[color:var(--ink)]/90">
                    Build tools
                  </div>
                </div>
                <div className="group relative overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)]">
                  <img
                    src="/landing2.jpeg"
                    alt="Script-driven workflows"
                    className="h-28 w-full object-cover transition duration-500 group-hover:scale-[1.03] md:h-32"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-black/0" />
                  <div className="absolute bottom-0 left-0 right-0 p-3 text-[11px] font-semibold tracking-wide text-[color:var(--ink)]/90">
                    Run experiments
                  </div>
                </div>
                <div className="group relative overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)]">
                  <img
                    src="/landing3.jpeg"
                    alt="Hardware exploration"
                    className="h-28 w-full object-cover transition duration-500 group-hover:scale-[1.03] md:h-32"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-black/0" />
                  <div className="absolute bottom-0 left-0 right-0 p-3 text-[11px] font-semibold tracking-wide text-[color:var(--ink)]/90">
                    Keep artifacts
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
                  <div className="text-xs font-semibold text-[color:var(--aqua)]">Scripts</div>
                  <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                    UI + device I/O in one file. No reflash loops.
                  </div>
                </div>
                <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
                  <div className="text-xs font-semibold text-[color:var(--sky)]">ELM Agent (Pro)</div>
                  <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                    Ask for an experiment. Get a runnable script (with UI) you can edit.
                  </div>
                </div>
                <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
                  <div className="text-xs font-semibold text-[color:var(--copper)]">One platform</div>
                  <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                    One USB device + apps on Android, iOS, macOS, and Windows.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-14">
          <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-6 md:p-10">
            <div className="grid gap-8 md:grid-cols-[1.05fr_0.95fr] md:items-start">
              <div className="space-y-4">
                <div className="text-xs font-semibold tracking-wide text-[color:var(--sky)]">
                  Introducing vibe hardware hacking
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--ink)] md:text-3xl">
                  Prompt → script → run.
                  <br />
                  Keep the good ones.
                </h2>
                <p className="max-w-xl text-[15px] leading-7 text-[color:var(--ink-dim)]">
                  The in-app agent helps you turn vague ideas into concrete, runnable scripts with real UI.
                  You get a starting point fast, then you iterate.
                </p>
                <div className="flex flex-wrap gap-2 pt-1 text-xs text-[color:var(--ink-dim)]">
                  <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1">
                    Generates a script
                  </div>
                  <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1">
                    Adds UI controls
                  </div>
                  <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1">
                    Runs + refines
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.65)] p-5 shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
                <div className="flex items-center justify-between gap-4">
                  <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">
                    Example prompts
                  </div>
                  <div className="text-[11px] text-[color:var(--ink-dim)]">and what you get back</div>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-4">
                    <div className="font-mono text-[12px] leading-6 text-[color:var(--ink)]">
                      <div className="text-[color:var(--aqua)]">You</div>
                      <div>“Make a script UI that captures a signal and replays it.”</div>
                      <div className="mt-2 text-[color:var(--sky)]">Agent</div>
                      <div>Creates a capture + replay panel with a named library.</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-4">
                    <div className="font-mono text-[12px] leading-6 text-[color:var(--ink)]">
                      <div className="text-[color:var(--aqua)]">You</div>
                      <div>“Probe this module and tell me what it is.”</div>
                      <div className="mt-2 text-[color:var(--sky)]">Agent</div>
                      <div>Scans the bus, tries common IDs, then builds a bring-up UI.</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-4">
                    <div className="font-mono text-[12px] leading-6 text-[color:var(--ink)]">
                      <div className="text-[color:var(--aqua)]">You</div>
                      <div>“Give me a dashboard to sample, label, and export readings.”</div>
                      <div className="mt-2 text-[color:var(--sky)]">Agent</div>
                      <div>Builds controls + logs + export so you can share the artifact.</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-14">
          <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-6 md:p-10">
            <div className="grid gap-8 md:grid-cols-2 md:items-center">
              <div className="space-y-3">
                <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--ink)] md:text-3xl">
                  One script, every surface.
                </h2>
                <p className="text-[15px] leading-7 text-[color:var(--ink-dim)]">
                  The same script UI renders consistently across Android, iOS, and Desktop.
                </p>
                <div className="flex flex-wrap gap-3 pt-2">
                  <img
                    src="/script_ios.PNG"
                    alt="Script UI on iOS"
                    className="h-44 w-auto rounded-xl border border-[color:var(--line)] bg-black/20 object-contain"
                  />
                  <img
                    src="/script_android.jpg"
                    alt="Script UI on Android"
                    className="h-44 w-auto rounded-xl border border-[color:var(--line)] bg-black/20 object-contain"
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.6)] p-5">
                <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">
                  Example
                </div>
                <div className="pt-2 font-mono text-[12px] leading-6 text-[color:var(--ink)]">
                  <pre className="whitespace-pre-wrap">
{`const status = Signals.state("Ready");

UI.render(UI.column({
  spacing: 12,
  children: [
    UI.text({ text: "Hello, EMWaver", font: "title2" }),
    UI.button({
      label: "Ping device",
      onTap: () => {
        status.set("Pinging...");
        Device.ping();
        status.set("OK");
      },
    }),
    UI.text({ text: "Status: " + status.get() }),
  ],
}));`}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-16">
          <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-6 md:p-10">
            <div className="flex items-end justify-between gap-6">
              <div>
                <div className="text-xs font-semibold tracking-wide text-[color:var(--aqua)]">
                  Install
                </div>
                <h2 className="pt-2 text-2xl font-semibold tracking-tight text-[color:var(--ink)] md:text-3xl">
                  Start with the basics.
                </h2>
                <p className="pt-2 max-w-2xl text-[15px] leading-7 text-[color:var(--ink-dim)]">
                  Install the apps, skim the pinout, then run scripts. Order/build details
                  are here too.
                </p>
              </div>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <Link
                href="/install"
                className="group rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
              >
                <div className="text-xs font-semibold text-[color:var(--aqua)]">Installing</div>
                <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
                  Installing & using
                </div>
                  <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                    Install the apps and connect to your device.
                  </div>
                </Link>

              <Link
                href="/scripts"
                className="group rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
              >
                <div className="text-xs font-semibold text-[color:var(--sky)]">Scripts</div>
                <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
                  Run a script
                </div>
                <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                  UI + device APIs, fast iteration.
                </div>
              </Link>

              <Link
                href="/pinout"
                className="group rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
              >
                <div className="text-xs font-semibold text-[color:var(--copper)]">Pinout</div>
                <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
                  Pinout reference
                </div>
                <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                  Headers, GPIO numbering, and key pins.
                </div>
              </Link>

              <Link
                href="/device"
                className="group rounded-2xl border border-[color:var(--line)] bg-[rgba(78,231,199,0.08)] p-5 hover:bg-[rgba(78,231,199,0.12)]"
              >
                <div className="text-xs font-semibold text-[color:var(--aqua)]">Device</div>
                <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
                  Current board
                </div>
                <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                  What ships today and what it is optimized for.
                </div>
              </Link>

                <Link
                  href="/order"
                  className="group rounded-2xl border border-[color:var(--line)] bg-[rgba(240,166,106,0.10)] p-5 hover:bg-[rgba(240,166,106,0.14)]"
                >
                  <div className="text-xs font-semibold text-[color:var(--copper)]">Builder</div>
                  <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
                    Order
                  </div>
                  <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                    Device orders coming soon.
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
