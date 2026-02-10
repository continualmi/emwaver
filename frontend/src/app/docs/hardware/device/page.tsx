import Link from "next/link";

export default function DeviceDocPage() {
  return (
    <>
      <h1>Current board</h1>
      <p>
        EMWaver ships a single USB device designed around scripts + UI rather than reflashing loops.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Link
          href="/docs/hardware/pinout"
          className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
        >
          <div className="text-xs font-semibold text-[color:var(--sky)]">Pinout</div>
          <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">Headers + GPIO map</div>
          <div className="pt-2 text-sm text-[color:var(--ink-dim)]">SPI/I2C/UART + internal pins.</div>
        </Link>
        <Link
          href="/order"
          className="no-underline rounded-2xl border border-[color:var(--line)] bg-[rgba(240,166,106,0.10)] p-5 hover:bg-[rgba(240,166,106,0.14)]"
        >
          <div className="text-xs font-semibold text-[color:var(--copper)]">Builder</div>
          <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">Order</div>
          <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Device orders coming soon.</div>
        </Link>
      </div>

      <h2>What you get</h2>
      <ul>
        <li>One board</li>
        <li>One transport (USB)</li>
        <li>One set of apps (Android / iOS / Desktop)</li>
      </ul>

      <h2>What it is optimized for</h2>
      <p>
        Fast hardware exploration: scripts run locally in the apps, render real UI, and talk to the
        device over a stable USB protocol.
      </p>
    </>
  );
}
