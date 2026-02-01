import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

export default function HardwarePage() {
  return (
    <div className="min-h-dvh">
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid gap-8 md:grid-cols-[1.15fr_0.85fr] md:items-start">
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1 text-xs text-[color:var(--ink-dim)]">
              <span className="inline-block h-2 w-2 rounded-full bg-[color:var(--copper)]" />
              Current device
            </div>

            <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">
              EMWaver hardware
            </h1>

            <p className="max-w-2xl text-[15px] leading-7 text-[color:var(--ink-dim)]">
              A focused hardware platform designed for exploration. Variants are population/placement
              options so the experience stays consistent.
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              <Link
                href="/device"
                className="group rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
              >
                <div className="text-xs font-semibold text-[color:var(--aqua)]">Device</div>
                <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
                  Current board overview
                </div>
                <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                  What it is, what it ships with, and the product direction.
                </div>
              </Link>

              <Link
                href="/pinout"
                className="group rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
              >
                <div className="text-xs font-semibold text-[color:var(--sky)]">Pinout</div>
                <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
                  GPIOs + headers
                </div>
                <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                  Diagram, header map, and GPIO reference.
                </div>
              </Link>

              <Link
                href="/order"
                className="group rounded-2xl border border-[color:var(--line)] bg-[rgba(240,166,106,0.10)] p-5 hover:bg-[rgba(240,166,106,0.14)]"
              >
                <div className="text-xs font-semibold text-[color:var(--copper)]">
                  Builder
                </div>
                <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
                  Order
                </div>
                <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                  Device orders coming soon.
                </div>
              </Link>

              
            </div>
          </div>

          <div className="space-y-4">
            <div className="overflow-hidden rounded-3xl border border-[color:var(--line)] bg-[color:var(--surface)] shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
              <img
                src="/EMWAVER.jpg"
                alt="EMWaver device"
                className="h-auto w-full object-cover"
              />
            </div>

            <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-5">
              <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">
                Design rules
              </div>
              <div className="pt-3 space-y-2 text-sm text-[color:var(--ink-dim)]">
                <div>One platform, consistent behavior</div>
                <div>Agent-assisted iteration</div>
                <div>Scripts + UI as the primary interface</div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
