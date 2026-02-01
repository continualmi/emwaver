import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

type NavItem = {
  href: string;
  label: string;
};

const NAV: NavItem[] = [
  { href: "/order", label: "Order" },
  { href: "/install", label: "Install" },
  { href: "/docs", label: "Documentation" },
  { href: "/device", label: "Device" },
];

function NavLinks({ activeHref }: { activeHref: string }) {
  return (
    <div className="space-y-1">
      {NAV.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              "block rounded-xl px-3 py-2 text-sm font-semibold transition " +
              (active
                ? "bg-[color:var(--surface)] text-[color:var(--ink)]"
                : "text-[color:var(--ink)] hover:bg-[color:var(--surface)]")
            }
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

export function InformativeShell({
  activeHref,
  title,
  description,
  children,
}: {
  activeHref: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh docs-mode">
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid gap-6 md:grid-cols-[260px_minmax(0,1fr)] md:items-start">
          <aside className="hidden md:block">
            <div className="sticky top-24">
              <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
                <div className="mb-3 text-xs font-semibold tracking-wide text-[color:var(--ink)]">
                  Reference
                </div>
                <NavLinks activeHref={activeHref} />
              </div>
            </div>
          </aside>

          <div className="min-w-0">
            <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-6 md:p-10">
              <div className="md:hidden">
                <div className="mb-6 flex gap-2 overflow-x-auto rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.55)] p-2 backdrop-blur">
                  {NAV.map((item) => {
                    const active = item.href === activeHref;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={
                          "whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold " +
                          (active
                            ? "bg-[color:var(--surface)] text-[color:var(--ink)]"
                            : "text-[color:var(--ink)] hover:bg-[color:var(--surface)]")
                        }
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>

              <header className="mb-8">
                <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">
                  {title}
                </h1>
                {description ? (
                  <p className="pt-3 max-w-2xl text-[15px] leading-7 text-[color:var(--ink-dim)]">
                    {description}
                  </p>
                ) : null}
              </header>

              <div className="prose-emw">{children}</div>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
