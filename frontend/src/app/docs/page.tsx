import Link from "next/link";
import { InformativeShell } from "@/components/InformativeShell";

export default function DocsIndex() {
  return (
    <InformativeShell
      activeHref="/docs"
      title="Documentation"
      description="Everything you need to install, connect, and run scripts."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Link
          href="/install"
          className="block rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
        >
          <div className="text-xs font-semibold text-[color:var(--aqua)]">Install</div>
          <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
            Install & connect
          </div>
          <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
            Get the apps and connect over USB.
          </div>
        </Link>

        <Link
          href="/scripts"
          className="block rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
        >
          <div className="text-xs font-semibold text-[color:var(--sky)]">Scripts</div>
          <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
            Run scripts
          </div>
          <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
            Start from default scripts or write your own.
          </div>
        </Link>

        <Link
          href="/pinout"
          className="block rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
        >
          <div className="text-xs font-semibold text-[color:var(--copper)]">Pinout</div>
          <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
            Pinout reference
          </div>
          <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
            Headers, GPIO numbering, and key pins.
          </div>
        </Link>

        <Link
          href="/device"
          className="block rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
        >
          <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Device</div>
          <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
            Current board
          </div>
          <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
            What ships today and what it is optimized for.
          </div>
        </Link>
      </div>
    </InformativeShell>
  );
}
