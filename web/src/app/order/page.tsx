import Link from "next/link";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

const devices = [
  {
    title: "EMWaver DIY",
    status: "Coming soon",
    image: "/EMWAVER.png",
    alt: "EMWaver DIY device",
    description:
      "The current hands-on EMWaver board. Built for expansion with the newer EMWaver DIY layout and intended as the practical module-ready device.",
    detail: "This will be sold directly when orders open.",
  },
  {
    title: "EMWaver",
    status: "Coming soon",
    image: "/EMWAVER-old.jpg",
    alt: "EMWaver integrated device",
    description:
      "The integrated EMWaver device stays visible as the flagship hardware direction, but it is not available for direct purchase yet.",
    detail: "This will also be sold directly once the hardware launch is ready.",
  },
];

const buildSteps = [
  "Open the hardware catalog and pick the board you want to build.",
  "Review the gallery, board details, and build files.",
  "Use the builder flow for BOM, fabrication files, and JLCPCB-oriented output.",
];

export default function OrderPage() {
  return (
    <div className="min-h-dvh docs-mode">
      <SiteHeader />
      <main className="w-full px-5 py-10">
        <div className="mx-auto max-w-7xl space-y-8">
          <section className="overflow-hidden rounded-[2rem] border border-[color:var(--line)] bg-[radial-gradient(circle_at_top_left,rgba(78,231,199,0.16),rgba(255,255,255,0.03)_38%,rgba(255,255,255,0.02)_100%)] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.32)] md:p-10">
            <div className="max-w-4xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-[rgba(255,255,255,0.06)] px-4 py-1.5 text-xs font-semibold text-[color:var(--ink-dim)]">
                <span className="inline-block h-2 w-2 rounded-full bg-[color:var(--copper)]" />
                Direct sales not open yet
              </div>

              <h1 className="pt-5 text-4xl font-semibold tracking-tight text-[color:var(--ink)] md:text-6xl">
                Two EMWaver devices are planned for sale.
              </h1>

              <p className="max-w-3xl pt-5 text-[16px] leading-8 text-[color:var(--ink-dim)]">
                `EMWaver DIY` and `EMWaver` are both staying on the roadmap as hardware products,
                but for now they are marked <strong className="text-[color:var(--ink)]">Coming soon</strong>.
                Until direct sales open, the clearest path is the hardware section where you can
                inspect the boards and build from JLCPCB-oriented files.
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                <Link
                  href="/hardware"
                  className="rounded-2xl bg-[color:var(--ink)] px-5 py-3 text-sm font-semibold text-[color:var(--paper)] transition hover:opacity-95"
                >
                  Build from hardware section
                </Link>
                <Link
                  href="/hardware/EMWAVER_DIY"
                  className="rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.05)] px-5 py-3 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[rgba(255,255,255,0.08)]"
                >
                  Open EMWaver DIY
                </Link>
              </div>
            </div>
          </section>

          <section className="grid gap-5 lg:grid-cols-2">
            {devices.map((device) => (
              <div
                key={device.title}
                className="overflow-hidden rounded-[1.8rem] border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] shadow-[0_24px_60px_rgba(0,0,0,0.22)]"
              >
                <div className="aspect-[4/3] overflow-hidden border-b border-[color:var(--line)] bg-[rgba(3,7,18,0.5)]">
                  <img src={device.image} alt={device.alt} className="h-full w-full object-cover" />
                </div>
                <div className="space-y-4 p-6">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-2xl font-semibold text-[color:var(--ink)]">{device.title}</div>
                    <div className="rounded-full border border-[rgba(240,166,106,0.35)] bg-[rgba(240,166,106,0.10)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--copper)]">
                      {device.status}
                    </div>
                  </div>
                  <p className="text-[15px] leading-7 text-[color:var(--ink-dim)]">{device.description}</p>
                  <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-4 text-sm leading-6 text-[color:var(--ink-dim)]">
                    {device.detail}
                  </div>
                </div>
              </div>
            ))}
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[1.8rem] border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-6 md:p-8">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--aqua)]">
                Build now
              </div>
              <h2 className="pt-3 text-2xl font-semibold text-[color:var(--ink)] md:text-3xl">
                Use the hardware section if you want to make one now.
              </h2>
              <p className="max-w-2xl pt-4 text-[15px] leading-7 text-[color:var(--ink-dim)]">
                The hardware catalog is the practical route today. It should read like: browse the
                device, inspect the files, then move into the builder/JLCPCB flow without guessing
                whether you are ordering from EMWaver or building it yourself.
              </p>

              <div className="mt-6 space-y-3">
                {buildSteps.map((step, index) => (
                  <div
                    key={step}
                    className="flex items-start gap-4 rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.32)] p-4"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgba(78,231,199,0.14)] text-sm font-semibold text-[color:var(--aqua)]">
                      {index + 1}
                    </div>
                    <div className="pt-1 text-sm leading-6 text-[color:var(--ink-dim)]">{step}</div>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/hardware"
                  className="rounded-2xl bg-[color:var(--aqua)] px-5 py-3 text-sm font-semibold text-[rgb(5,12,18)] transition hover:opacity-95"
                >
                  Open hardware catalog
                </Link>
                <Link
                  href="/hardware/emwaver"
                  className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] px-5 py-3 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface-2)]"
                >
                  View EMWaver
                </Link>
              </div>
            </div>

            <div className="rounded-[1.8rem] border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-6 md:p-8">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--sky)]">
                What this page means
              </div>
              <div className="mt-4 space-y-4 text-sm leading-7 text-[color:var(--ink-dim)]">
                <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-4">
                  `Order` now means product availability and direction, not an active checkout.
                </div>
                <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-4">
                  Both hardware products remain visible so users understand what will be sold later.
                </div>
                <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-4">
                  The hardware section is the immediate action path for self-build and JLCPCB-based fabrication.
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
