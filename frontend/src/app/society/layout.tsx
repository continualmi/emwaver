import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { SocietyTabs } from "@/app/society/societyTabs";

export default function SocietyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-5 py-10">
        <div className="flex flex-col gap-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-[color:var(--ink)]">EMWaver Society</h1>
            <p className="text-sm text-[color:var(--ink-dim)]">
              Community posts, scripts, and videos — tied to your EMWaver account.
            </p>
          </div>

          <SocietyTabs />

          {children}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
