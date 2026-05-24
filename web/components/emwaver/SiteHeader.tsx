"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { societyRouteUrl } from "@/lib/emwaver/societySite";

const nav = [
  { href: "/emwaver/build", label: "Build" },
  { href: "/emwaver/install", label: "Install" },
  { href: "/emwaver/docs", label: "Documentation" },
  { href: "/emwaver/videos", label: "Videos" },
  { href: societyRouteUrl("/society"), label: "Community" },
];

export function SiteHeader() {
  const pathname = usePathname() || "/";
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  function closeMobileMenu() {
    setMobileMenuOpen(false);
  }

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-[color:var(--line)] bg-[color:var(--glass)] backdrop-blur">
        <div className="flex w-full items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <a
              href="https://continualmi.com"
              className="h-9 w-9 overflow-hidden rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] p-1"
              aria-label="Continual MI"
            >
              <Image
                src="/emwaver/continuous-logo.png"
                alt="Continual MI"
                width={36}
                height={36}
                className="h-full w-full object-contain"
              />
            </a>
            <Link href="/emwaver" className="flex items-center gap-3">
              <div className="h-9 w-9 overflow-hidden rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)]">
                <Image
                  src="/emwaver/logo.png"
                  alt="EMWaver"
                  width={36}
                  height={36}
                  className="h-full w-full object-cover"
                />
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
          </div>

          <nav className="hidden items-center gap-2 text-[13px] text-[color:var(--ink-dim)] md:flex">
            {nav.map((item) => {
              const external = item.href.startsWith("http");
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
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

            <a
              href="https://github.com/continualmi/emwaver"
              target="_blank"
              rel="noreferrer"
              className="ml-2 inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-2 text-[color:var(--ink)] transition hover:bg-[color:var(--surface-2)]"
              aria-label="GitHub"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              GitHub
            </a>
          </nav>

          <div className="flex items-center gap-2 md:hidden">
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-2 text-sm font-semibold text-[color:var(--ink)]"
              onClick={() => setMobileMenuOpen((value) => !value)}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-site-nav"
            >
              Menu
            </button>
          </div>
        </div>
        {mobileMenuOpen ? (
          <nav
            id="mobile-site-nav"
            className="border-t border-[color:var(--line)] bg-[color:var(--glass-heavy)] px-5 py-3 md:hidden"
          >
            <div className="flex flex-col gap-2 text-sm text-[color:var(--ink)]">
              {nav.map((item) => {
                const external = item.href.startsWith("http");
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);
                const navClass =
                  "rounded-xl px-3 py-3 transition " +
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
                    onClick={closeMobileMenu}
                  >
                    {item.label}
                  </a>
                ) : (
                  <Link key={item.href} href={item.href} className={navClass} onClick={closeMobileMenu}>
                    {item.label}
                  </Link>
                );
              })}
              <a
                href="https://github.com/continualmi/emwaver"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl border border-[color:var(--line)] px-3 py-3 text-[color:var(--ink)] transition hover:bg-[color:var(--surface)]"
                onClick={closeMobileMenu}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
                GitHub
              </a>
            </div>
          </nav>
        ) : null}
      </header>
      <div className="h-[74px]" aria-hidden="true" />
    </>
  );
}
