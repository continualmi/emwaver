"use client";

import { SiteHeader } from "@/components/SiteHeader";
import { emwaverNativeHandoffUrl } from "@/lib/clientSession";

export default function AuthHandoffPage() {
  const handoffUrl = emwaverNativeHandoffUrl();

  return (
    <div className="min-h-dvh docs-mode">
      <SiteHeader />
      <main className="w-full overflow-y-auto px-5 py-10">
        <div className="rounded-3xl border border-[color:var(--line)] bg-[color:var(--surface-3)] p-6 md:p-10">
          <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">Continue in the EMWaver app</h1>
          <p className="pt-3 text-[15px] leading-7 text-[color:var(--ink-dim)]">
            Native EMWaver sign-in codes are now issued by the shared Continual platform.
          </p>

          <div className="mt-6 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
            <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">Next step</div>
            <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
              Open the Continual handoff page, sign in if needed, then copy the one-time code into the EMWaver app.
            </div>

            <div className="mt-4">
              <a
                href={handoffUrl}
                className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] hover:opacity-95"
              >
                Open Continual Handoff
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
