"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
// News has moved to EMWaver Society.

function isActive(pathname: string, href: string) {
  return pathname === href;
}

export function NewsSidebar() {
  const pathname = usePathname();

  return (
    <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.55)] p-4 backdrop-blur">
      <div className="mb-3 text-xs font-semibold tracking-wide text-[color:var(--ink)]">
        EMWaver Society
      </div>

      <div className="space-y-1">
        <Link
          href="/society"
          className={
            "block rounded-xl px-3 py-2 text-sm font-semibold transition " +
            (isActive(pathname, "/society")
              ? "bg-[color:var(--surface)] text-[color:var(--ink)]"
              : "text-[color:var(--ink-dim)] hover:bg-[rgba(255,255,255,0.06)] hover:text-[color:var(--ink)]")
          }
        >
          Society
        </Link>

        <div className="my-3 border-t border-[color:var(--line)]" />

        <div className="rounded-xl px-3 py-2 text-sm text-[color:var(--ink-dim)]">
          News has moved to EMWaver Society.
        </div>
      </div>
    </div>
  );
}
