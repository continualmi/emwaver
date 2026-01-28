import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { loadMkdocsNav, type NavItem } from "@/lib/docs/nav";

function NavTree({ items }: { items: NavItem[] }) {
  return (
    <div className="space-y-2">
      {items.map((item) => {
        if (item.type === "link") {
          return (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-lg px-2 py-1 text-sm text-[color:var(--ink-dim)] hover:bg-[color:var(--surface)] hover:text-[color:var(--ink)]"
            >
              {item.title}
            </Link>
          );
        }

        return (
          <div key={item.title} className="pt-2">
            <div className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-[color:var(--ink)]/80">
              {item.title}
            </div>
            <div className="pl-2">
              <NavTree items={item.items} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default async function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nav = await loadMkdocsNav();

  return (
    <div className="min-h-dvh docs-mode">
      <SiteHeader />

      <div className="mx-auto grid max-w-6xl gap-6 px-5 py-8 md:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="hidden md:block">
          <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
            <div className="mb-3 text-xs font-semibold tracking-wide text-[color:var(--ink)]">
              Reference
            </div>
            <NavTree items={nav} />
          </div>
        </aside>

        <div className="min-w-0">
          <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-6 md:p-10">
            {children}
          </div>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
