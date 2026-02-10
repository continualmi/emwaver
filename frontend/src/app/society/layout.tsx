import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { SocietyTabs } from "@/app/society/societyTabs";

export default function SocietyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-hidden">
      {/* Society has its own vibe + the 2015 background (visible, then blur on top — no dark fade). */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <img src="/2015_upscale.jpg" alt="" className="h-full w-full object-cover opacity-[0.72]" />
        {/* keep a tiny contrast helper, but avoid the heavy dark overlay */}
        <div className="absolute inset-0 bg-[radial-gradient(900px_600px_at_15%_0%,rgba(255,255,255,0.10),transparent_60%),radial-gradient(900px_600px_at_85%_10%,rgba(78,231,199,0.10),transparent_62%)]" />
      </div>

      <SiteHeader />

      <main className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid gap-6 md:grid-cols-[280px_1fr] md:items-start">
          {/* Left rail (distinct Society layout) */}
          <aside className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.07)] p-6 backdrop-blur-xl md:sticky md:top-24">
            <div className="space-y-3">
              <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">EMWaver</div>
              <div className="text-2xl font-semibold tracking-tight text-[color:var(--ink)]">Society</div>
              <p className="text-sm leading-6 text-[color:var(--ink-dim)]">
                Posts, scripts, and videos.
                <br />
                Comments require a device-attached account.
              </p>
            </div>

            <div className="mt-5">
              <SocietyTabs />
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <Link
                href="/account"
                className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.06)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[rgba(255,255,255,0.10)]"
              >
                My account
              </Link>
            </div>
          </aside>

          {/* Main content */}
          <section className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.07)] p-6 backdrop-blur-xl md:p-8">
            {children}
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
