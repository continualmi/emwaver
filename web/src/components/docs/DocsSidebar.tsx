"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_NAV } from "@/components/docs/docsNav";

function isActive(pathname: string, href: string) {
  if (href === "/docs") return pathname === "/docs";
  return pathname === href || pathname.startsWith(href + "/");
}

export function DocsSidebar() {
  const pathname = usePathname();

  return (
    <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.55)] p-4 backdrop-blur">
      <div className="mb-3 text-xs font-semibold tracking-wide text-[color:var(--ink)]">
        Docs
      </div>

      <div className="space-y-5">
        {DOCS_NAV.map((group) => (
          <div key={group.heading}>
            <div className="mb-2 text-[11px] font-semibold tracking-wider text-[color:var(--ink-dim)]">
              {group.heading.toUpperCase()}
            </div>
            <div className="space-y-1">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={
                      "group block rounded-xl px-3 py-2 text-sm transition " +
                      (active
                        ? "bg-[color:var(--surface)] text-[color:var(--ink)]"
                        : "text-[color:var(--ink-dim)] hover:bg-[rgba(255,255,255,0.06)] hover:text-[color:var(--ink)]")
                    }
                  >
                    <div className="font-semibold">{item.label}</div>
                    {item.description ? (
                      <div className="pt-0.5 text-[12px] leading-5 text-[color:var(--ink-dim)]">
                        {item.description}
                      </div>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
