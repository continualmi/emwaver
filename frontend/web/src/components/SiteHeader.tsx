import Link from "next/link";

const nav = [
  { href: "/docs/overview", label: "Docs" },
  { href: "/hardware", label: "Hardware" },
  { href: "/news", label: "News" },
  { href: "https://github.com/luispl77/emwaver/releases", label: "Releases" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-[color:var(--line)] bg-[rgba(6,8,16,0.7)] backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Link href="/" className="flex items-center gap-3">
          <div className="h-9 w-9 overflow-hidden rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)]">
            <img
              src="/_docs/logo.png"
              alt="EMWaver"
              className="h-full w-full object-cover"
            />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight text-[color:var(--ink)]">
              EMWaver
            </div>
            <div className="text-[12px] text-[color:var(--ink-dim)]">
              Script-first hardware exploration
            </div>
          </div>
        </Link>

        <nav className="hidden items-center gap-6 text-[13px] text-[color:var(--ink-dim)] md:flex">
          {nav.map((item) => {
            const external = item.href.startsWith("http");
            return external ? (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="hover:text-[color:var(--ink)]"
              >
                {item.label}
              </a>
            ) : (
              <Link
                key={item.href}
                href={item.href}
                className="hover:text-[color:var(--ink)]"
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
