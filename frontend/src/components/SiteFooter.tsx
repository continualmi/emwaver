export function SiteFooter() {
  return (
    <footer className="border-t border-[color:var(--line)] bg-[rgba(2,3,8,0.4)]">
      <div className="mx-auto grid max-w-6xl gap-6 px-5 py-10 md:grid-cols-3">
        <div className="space-y-3">
          <div className="text-sm font-semibold text-[color:var(--ink)]">EMWaver</div>
          <p className="text-sm text-[color:var(--ink-dim)]">
            One board. USB only. Scripts + UI together.
          </p>
        </div>

        <div className="space-y-2 text-sm text-[color:var(--ink-dim)]">
          <a className="block hover:text-[color:var(--ink)]" href="/scripts">
            Scripts
          </a>
          <a className="block hover:text-[color:var(--ink)]" href="/pinout">
            Pinout
          </a>
          <a className="block hover:text-[color:var(--ink)]" href="/order">
            Order
          </a>
          <a className="block hover:text-[color:var(--ink)]" href="/news">
            News
          </a>
        </div>

        <div className="space-y-2 text-sm text-[color:var(--ink-dim)]">
          <a
            className="block hover:text-[color:var(--ink)]"
            href="https://www.youtube.com/@EMWavers"
            target="_blank"
            rel="noreferrer"
          >
            YouTube
          </a>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-5 pb-10 text-xs text-[color:var(--ink-dim)]">
        © {new Date().getFullYear()} EMWaver
      </div>
    </footer>
  );
}
