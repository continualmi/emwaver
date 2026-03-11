"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_NAV } from "@/components/docs/docsNav";

function activeLabel(pathname: string) {
  for (const group of DOCS_NAV) {
    for (const item of group.items) {
      if (item.href === "/docs" && pathname === "/docs") return item.label;
      if (item.href !== "/docs" && (pathname === item.href || pathname.startsWith(item.href + "/"))) {
        return item.label;
      }
    }
  }
  return "Docs";
}

export function DocsMobileNav() {
  const pathname = usePathname();
  const current = activeLabel(pathname);

  return (
    <details className="rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.55)] p-3 backdrop-blur">
      <summary className="cursor-pointer list-none text-sm font-semibold text-[color:var(--ink)]">
        {current}
        <span className="pl-2 text-xs font-semibold text-[color:var(--ink-dim)]">
          (tap for menu)
        </span>
      </summary>

      <div className="mt-3 grid gap-2">
        {DOCS_NAV.map((group) => (
          <div key={group.heading}>
            <div className="mb-1 text-[11px] font-semibold tracking-wider text-[color:var(--ink-dim)]">
              {group.heading.toUpperCase()}
            </div>
            <div className="grid gap-1">
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-xl px-3 py-2 text-sm text-[color:var(--ink-dim)] hover:bg-[rgba(255,255,255,0.06)] hover:text-[color:var(--ink)]"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
