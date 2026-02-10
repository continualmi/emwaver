"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function tabClass(active: boolean) {
  return (
    "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition " +
    (active
      ? "bg-[color:var(--surface)] text-[color:var(--ink)] border border-[color:var(--line)]"
      : "text-[color:var(--ink-dim)] hover:text-[color:var(--ink)] hover:bg-[rgba(255,255,255,0.06)]")
  );
}

export function SocietyTabs() {
  const pathname = usePathname();

  const items = [
    { href: "/society", label: "Posts" },
    { href: "/society/scripts", label: "EMWaver Scripts" },
    { href: "/society/videos", label: "Videos" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => (
        <Link key={it.href} href={it.href} className={tabClass(pathname === it.href)}>
          {it.label}
        </Link>
      ))}

      <div className="flex-1" />

      <Link
        href={`/signin?redirect=${encodeURIComponent(pathname || "/society")}`}
        className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
      >
        Sign in
      </Link>
    </div>
  );
}
