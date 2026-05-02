import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";

export default function CloudPage() {
  return (
    <div className="min-h-dvh docs-mode">
      <SiteHeader />

      <main className="w-full px-5 py-10">
        <div className="mx-auto max-w-4xl">
          <section className="rounded-[2rem] border border-[color:var(--line)] bg-[color:var(--surface-3)] px-6 py-8 shadow-[0_24px_70px_var(--shadow)] md:px-10 md:py-11">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--aqua)]">
              Local-first control
            </div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">
              Use the localhost gateway.
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-8 text-[color:var(--ink-dim)]">
              The old cloud dashboard is being removed from the core product. Local hardware control now belongs
              in the gateway running on the same machine as the native EMWaver app.
            </p>

            <div className="mt-7 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
              <div className="text-sm font-semibold text-[color:var(--ink)]">Start the local gateway</div>
              <pre className="mt-3 overflow-x-auto rounded-xl border border-[color:var(--line)] bg-[color:var(--image-well)] p-4 text-sm text-[color:var(--ink)]">
                <code>{`emwaver gateway --port 3921`}</code>
              </pre>
              <p className="mt-3 text-sm leading-6 text-[color:var(--ink-dim)]">
                Then open <code>http://127.0.0.1:3921</code>. The browser talks to the localhost gateway,
                the gateway controls the local macOS or Windows app, and the app owns script execution plus
                USB/device transport.
              </p>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
                <div className="text-sm font-semibold text-[color:var(--ink)]">No sign-in for local scripts</div>
                <p className="mt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
                  Core script execution should not require account auth, cloud activation, or hosted relay.
                </p>
              </div>
              <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
                <div className="text-sm font-semibold text-[color:var(--ink)]">App-owned hardware</div>
                <p className="mt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
                  The gateway forwards script and UI messages; the native app talks to the connected board.
                </p>
              </div>
              <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
                <div className="text-sm font-semibold text-[color:var(--ink)]">User-owned remote access</div>
                <p className="mt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
                  Use SSH, port forwarding, or VPN if you intentionally want to reach the local gateway remotely.
                </p>
              </div>
            </div>

            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/docs/scripts"
                className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] hover:opacity-95"
              >
                Script docs
              </Link>
              <Link
                href="/install"
                className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                Install EMWaver
              </Link>
              <Link
                href="/build"
                className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                Supported hardware
              </Link>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
