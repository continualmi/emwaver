"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function tabClass(active: boolean) {
  return (
    "group flex w-full items-center justify-between rounded-xl border px-4 py-2.5 text-sm font-semibold transition " +
    (active
      ? "border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]"
      : "border-transparent text-[color:var(--ink-dim)] hover:border-[color:var(--line)] hover:bg-[rgba(255,255,255,0.06)] hover:text-[color:var(--ink)]")
  );
}

export function SocietyTabs() {
  const pathname = usePathname();

  const items = [
    { href: "/society", label: "Posts" },
    { href: "/society/forum", label: "Forum" },
    { href: "/society/scripts", label: "Script Library" },
    { href: "/society/videos", label: "Videos" },
  ];

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-dim)]">Sections</div>
        <ul className="mt-2 space-y-1">
          {items.map((it) => {
            const active = pathname === it.href;
            return (
              <li key={it.href}>
                <Link href={it.href} className={tabClass(active)}>
                  <span>{it.label}</span>
                  <span
                    className={
                      "text-xs transition " +
                      (active ? "text-[color:var(--aqua)]" : "text-[color:var(--ink-dim)] group-hover:text-[color:var(--ink)]")
                    }
                    aria-hidden
                  >
                    →
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="space-y-2 border-t border-[color:var(--line)] pt-4">
        <Link
          href={`/signin?redirect=${encodeURIComponent(pathname || "/society")}`}
          className="inline-flex w-full items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}
