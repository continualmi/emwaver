import Link from "next/link";

const links = [
  { href: "/privacy", label: "Privacy" },
  { href: "/support", label: "Support" },
  { href: "/docs", label: "Docs" },
  { href: "https://github.com/continualmi/emwaver", label: "GitHub", external: true },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-[color:var(--line)] bg-[color:var(--glass)] px-5 py-8 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 text-sm text-[color:var(--ink-dim)] md:flex-row md:items-center md:justify-between">
        <div>
          <div className="font-semibold text-[color:var(--ink)]">EMWaver</div>
          <div className="mt-1 text-xs">A local-first Continual MI electronics platform.</div>
        </div>
        <nav className="flex flex-wrap gap-4">
          {links.map((link) =>
            link.external ? (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="transition hover:text-[color:var(--ink)]"
              >
                {link.label}
              </a>
            ) : (
              <Link key={link.href} href={link.href} className="transition hover:text-[color:var(--ink)]">
                {link.label}
              </Link>
            )
          )}
        </nav>
      </div>
    </footer>
  );
}
