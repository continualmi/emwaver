import Link from "next/link";

export default function ScriptsDocPage() {
  return (
    <>
      <h1>Run scripts</h1>
      <p>
        Scripts are the core UX: UI + device APIs in one file, fast iteration, no reflashing loop.
      </p>

      <h2>What a script is</h2>
      <p>
        A script is a small program that renders UI and calls into device APIs. The goal is to make a
        workflow feel like a product screen: buttons, pickers, live views, and logs.
      </p>

      <h2>How you use them</h2>
      <ol>
        <li>Connect the device</li>
        <li>Open Scripts in the app</li>
        <li>Run a script (or duplicate and edit one)</li>
      </ol>

      <h2>Related</h2>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Link
          href="/docs/hardware/pinout"
          className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
        >
          <div className="text-xs font-semibold text-[color:var(--sky)]">Hardware</div>
          <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">Pinout reference</div>
          <div className="pt-2 text-sm text-[color:var(--ink-dim)]">GPIO numbering + headers.</div>
        </Link>
        <Link
          href="/news"
          className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
        >
          <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Updates</div>
          <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">News</div>
          <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Releases + direction notes.</div>
        </Link>
      </div>

      <h2>Design goal</h2>
      <p>
        Optimize for iteration speed: edit a script, run it, and immediately get a new UI and workflow.
      </p>
    </>
  );
}
