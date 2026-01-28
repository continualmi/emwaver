import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

export default function HomePage() {
  return (
    <div className="min-h-dvh">
      <SiteHeader />

      <main>
        <section className="mx-auto max-w-6xl px-5 pt-14 pb-10">
          <div className="grid items-start gap-10 md:grid-cols-2">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1 text-xs text-[color:var(--ink-dim)]">
                <span className="inline-block h-2 w-2 rounded-full bg-[color:var(--aqua)]" />
                Offline-first hardware exploration
              </div>

              <h1 className="text-4xl leading-[1.02] font-semibold tracking-tight text-[color:var(--ink)] md:text-6xl">
                Hardware exploration,
                <br />
                built like software.
              </h1>

              <p className="max-w-xl text-[15px] leading-7 text-[color:var(--ink-dim)]">
                EMWaver is a script-centered hardware exploration platform. You iterate fast,
                build real UIs alongside experiments, and keep the workflow local-first.
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/docs/overview"
                  className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-5 py-3 text-sm font-semibold text-[color:var(--paper)] shadow-[0_18px_40px_var(--shadow)] hover:opacity-95"
                >
                  Read the docs
                </Link>
                <Link
                  href="/hardware"
                  className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-5 py-3 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
                >
                  Explore hardware
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
                <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
                  <div className="text-xs font-semibold text-[color:var(--aqua)]">Scripts</div>
                  <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                    UI + device I/O in one file. No reflash loops.
                  </div>
                </div>
                <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
                  <div className="text-xs font-semibold text-[color:var(--sky)]">Offline-first</div>
                  <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                    Core workflows work without internet.
                  </div>
                </div>
                <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
                  <div className="text-xs font-semibold text-[color:var(--copper)]">Single platform</div>
                  <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                    One device + apps that evolve with you.
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
      </main>

      <SiteFooter />
    </div>
  );
}
