"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_NAV } from "@/components/emwaver/docs/docsNav";

function findActiveHref(pathname: string): string | null {
  const allHrefs = DOCS_NAV.flatMap((g) => g.items.map((i) => i.href));
  const exact = allHrefs.find((h) => h === pathname);
  if (exact) return exact;
  const prefixMatches = allHrefs
    .filter((h) => h !== "/docs" && pathname.startsWith(h + "/"))
    .sort((a, b) => b.length - a.length);
  return prefixMatches[0] ?? null;
}

export function DocsSidebar() {
  const pathname = usePathname();
  const activeHref = findActiveHref(pathname);

  return (
    <nav className="docs-sidebar">
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
    </nav>
  );
}
