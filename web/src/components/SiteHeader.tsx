"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { societyRouteUrl } from "@/lib/societySite";

const nav = [
  { href: "/build", label: "Build" },
  { href: "/install", label: "Install" },
  { href: "/docs", label: "Documentation" },
  { href: societyRouteUrl("/society"), label: "Society" },
  { href: "/pro", label: "Pro" },
  { href: "/cloud", label: "Dashboard" },
  { href: "/account", label: "Account" },
];

export function SiteHeader() {
  const pathname = usePathname() || "/";

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-[color:var(--line)] bg-[color:var(--glass)] backdrop-blur">
        <div className="flex w-full items-center justify-between px-5 py-4">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 overflow-hidden rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] p-1">
                <img
                  src="/continuous-logo.png"
                  alt="Continual MI"
                  className="h-full w-full object-contain"
                />
              </div>
              <div className="h-9 w-9 overflow-hidden rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)]">
                <img
                  src="/logo.png"
                  alt="EMWaver"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-tight text-[color:var(--ink)]">
                EMWaver
              </div>
              <div className="text-[12px] text-[color:var(--ink-dim)]">
                A Continual MI platform
              </div>
            </div>
          </Link>

          <nav className="hidden items-center gap-2 text-[13px] text-[color:var(--ink-dim)] md:flex">
            {nav.map((item) => {
              const external = item.href.startsWith("http");
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const navClass =
                "rounded-lg px-3 py-2 transition " +
                (active
                  ? "bg-[color:var(--surface-2)] text-[color:var(--ink)]"
                  : "text-[color:var(--ink-dim)] hover:bg-[color:var(--surface)] hover:text-[color:var(--ink)]");

              return external ? (
                <a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className={navClass}
                >
                  {item.label}
                </a>
              ) : (
                <Link key={item.href} href={item.href} className={navClass}>
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <div className="h-[74px]" aria-hidden="true" />
    </>
  );
}
