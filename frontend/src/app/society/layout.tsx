import Link from "next/link";
// No SiteFooter in Society.
import { SiteHeader } from "@/components/SiteHeader";
import { SocietyTabs } from "@/app/society/societyTabs";

export default function SocietyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative app-shell-fixed society-mode">
      {/* Society has its own vibe + visible 2015 background (no dark overlay, no blur). */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <img src="/2015_upscale.jpg" alt="" className="h-full w-full object-cover opacity-[0.78]" />
      </div>

      <SiteHeader />

      <main className="app-shell-main w-full overflow-y-auto px-5 py-8 pb-10">
        <div className="grid min-h-0 gap-6 md:grid-cols-[280px_1fr] md:items-start">
          {/* Left rail (distinct Society layout) */}
          <aside className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.07)] p-6 backdrop-blur-md md:sticky md:top-24">
            <div className="space-y-3">
              <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">EMWaver</div>
              <div className="text-2xl font-semibold tracking-tight text-[color:var(--ink)]">Society</div>
              <p className="text-sm leading-6 text-[color:var(--ink-dim)]">
                Posts, forums, script drops, and videos.
                <br />
                Comments require a device-attached account.
              </p>
            </div>

            <div className="mt-5">
              <SocietyTabs />
            </div>

            <div className="mt-6 border-t border-[color:var(--line)] pt-4">
              <Link
                href="/account"
                className="inline-flex w-full items-center justify-center rounded-xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.06)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[rgba(255,255,255,0.10)]"
              >
                My account
              </Link>
            </div>
          </aside>

          {/* Main content */}
          <section className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.07)] p-6 backdrop-blur-md md:p-8">
            {children}
          </section>
        </div>
      </main>

      {/* No footer in Society (distinct section). */}
    </div>
  );
}
