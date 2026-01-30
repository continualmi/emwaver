import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

export default function OrderPage() {
  return (
    <div className="min-h-dvh docs-mode">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-5 py-10">
        <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-6 md:p-10">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">
                Order
              </h1>
              <p className="pt-3 max-w-2xl text-[15px] leading-7 text-[color:var(--ink-dim)]">
                Device orders are not open yet. This page will turn into the official ordering flow.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <a
                href="/device"
                className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                Current device
              </a>
              <a
                href="/pinout"
                className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                Pinout
              </a>
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
              <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">
                Status
              </div>
              <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">Coming soon</div>
              <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                We will announce availability when the order flow is live.
              </div>
            </div>

            <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(78,231,199,0.08)] p-5">
              <div className="text-xs font-semibold tracking-wide text-[color:var(--aqua)]">
                What ships
              </div>
              <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
                One board + apps
              </div>
              <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                USB-only transport, script-first exploration across mobile and desktop.
              </div>
            </div>

            <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(240,166,106,0.10)] p-5">
              <div className="text-xs font-semibold tracking-wide text-[color:var(--copper)]">
                Note
              </div>
              <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
                No fabrication files
              </div>
              <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                EMWaver is sold as a device; this site does not publish Gerbers or manufacturing packs.
              </div>
            </div>
          </div>

          <div className="mt-8 overflow-hidden rounded-3xl border border-[color:var(--line)] bg-[color:var(--surface)] shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
            <img src="/EMWAVER.jpg" alt="EMWaver device" className="h-auto w-full object-cover" />
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
