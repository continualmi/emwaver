"use client";

import { usePathname } from "next/navigation";
import { societyRouteUrl } from "@/lib/societySite";
// News has moved to the Society frontend.

function isActive(pathname: string, href: string) {
  return pathname === href;
}

export function NewsSidebar() {
  const pathname = usePathname();

  return (
    <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--glass)] p-4 backdrop-blur">
      <div className="mb-3 text-xs font-semibold tracking-wide text-[color:var(--ink)]">
        Continual Society
      </div>

      <div className="space-y-1">
        <a
          href={societyRouteUrl("/society")}
          className={
            "block rounded-xl px-3 py-2 text-sm font-semibold transition " +
            (isActive(pathname, "/society")
              ? "bg-[color:var(--surface)] text-[color:var(--ink)]"
              : "text-[color:var(--ink-dim)] hover:bg-[color:var(--surface)] hover:text-[color:var(--ink)]")
          }
        >
          Society
        </a>

        <div className="my-3 border-t border-[color:var(--line)]" />

        <div className="rounded-xl px-3 py-2 text-sm text-[color:var(--ink-dim)]">
          News has moved to the Society frontend.
        </div>
      </div>
    </div>
  );
}
