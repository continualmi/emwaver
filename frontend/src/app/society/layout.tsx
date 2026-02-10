import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { SocietyTabs } from "@/app/society/societyTabs";

export default function SocietyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-hidden">
      {/* Society has its own vibe + the 2015 background. */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <img
          src="/2015_upscale.jpg"
          alt=""
          className="h-full w-full object-cover opacity-[0.45]"
        />
        <div className="absolute inset-0 bg-[radial-gradient(1200px_700px_at_10%_0%,rgba(255,255,255,0.06),transparent_62%),radial-gradient(900px_600px_at_80%_10%,rgba(78,231,199,0.08),transparent_62%),linear-gradient(to_bottom,rgba(2,3,8,0.72),rgba(2,3,8,0.80))]" />
      </div>

      <SiteHeader />

      <main className="mx-auto max-w-6xl px-5 py-10">
        <div className="flex flex-col gap-6">
          <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.55)] p-6 backdrop-blur md:p-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="space-y-2">
                <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">
                  A place for members
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--ink)] md:text-3xl">
                  EMWaver Society
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-[color:var(--ink-dim)]">
                  Community posts, scripts, and videos. Comments are tied to your EMWaver account (device required).
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Link
                  href="/account"
                  className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[rgba(255,255,255,0.06)]"
                >
                  My account
                </Link>
              </div>
            </div>

            <div className="mt-5">
              <SocietyTabs />
            </div>
          </div>

          <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.50)] p-6 backdrop-blur md:p-8">
            {children}
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
