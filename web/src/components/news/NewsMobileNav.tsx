"use client";

import { usePathname } from "next/navigation";
import { societyRouteUrl } from "@/lib/societySite";
// News has moved to the Society frontend.

function currentLabel(pathname: string) {
  if (pathname === "/society") return "Continual Society";
  return "Continual Society";
}

export function NewsMobileNav() {
  const pathname = usePathname();
  const current = currentLabel(pathname);

  return (
    <details className="rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.55)] p-3 backdrop-blur">
      <summary className="cursor-pointer list-none text-sm font-semibold text-[color:var(--ink)]">
        {current}
        <span className="pl-2 text-xs font-semibold text-[color:var(--ink-dim)]">
          (tap for posts)
        </span>
      </summary>

      <div className="mt-3 grid gap-1">
        <a
          href={societyRouteUrl("/society")}
          className="rounded-xl px-3 py-2 text-sm text-[color:var(--ink-dim)] hover:bg-[rgba(255,255,255,0.06)] hover:text-[color:var(--ink)]"
        >
          Open Continual Society
        </a>
      </div>
    </details>
  );
}
