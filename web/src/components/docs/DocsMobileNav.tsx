"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_NAV } from "@/components/docs/docsNav";

function findActiveHref(pathname: string): string | null {
  const allHrefs = DOCS_NAV.flatMap((g) => g.items.map((i) => i.href));
  const exact = allHrefs.find((h) => h === pathname);
  if (exact) return exact;
  const prefixMatches = allHrefs
    .filter((h) => h !== "/docs" && pathname.startsWith(h + "/"))
    .sort((a, b) => b.length - a.length);
  return prefixMatches[0] ?? null;
}

function activeLabel(pathname: string) {
  const href = findActiveHref(pathname);
  if (!href) return "Docs";
  for (const group of DOCS_NAV) {
    for (const item of group.items) {
      if (item.href === href) return item.label;
    }
  }
  return "Docs";
}

export function DocsMobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = activeLabel(pathname);
  const activeHref = findActiveHref(pathname);

  return (
    <>
      <button
        className="docs-mobile-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-label="Toggle docs navigation"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 12h18M3 6h18M3 18h18" />
        </svg>
        <span>{current}</span>
      </button>

      {open && (
        <>
          <div className="docs-mobile-overlay" onClick={() => setOpen(false)} />
          <nav className="docs-mobile-drawer">
            <div className="docs-sidebar-brand">
              <img src="/logo.png" alt="EMWaver" className="docs-brand-logo" />
              <span className="docs-brand-text">Docs</span>
            </div>

            <div className="docs-sidebar-groups">
              {DOCS_NAV.map((group) => (
                <div key={group.heading} className="docs-nav-group">
                  <div className="docs-nav-heading">{group.heading}</div>
                  <ul className="docs-nav-list">
                    {group.items.map((item) => {
                      const active = item.href === activeHref;
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            className={`docs-nav-item${active ? " active" : ""}`}
                            onClick={() => setOpen(false)}
                          >
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d={item.iconPath} />
                            </svg>
                            <span>{item.label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>

            <div className="docs-sidebar-footer">
              <Link href="/" className="docs-footer-link" onClick={() => setOpen(false)}>
                &larr; Back to site
              </Link>
            </div>
          </nav>
        </>
      )}
    </>
  );
}
