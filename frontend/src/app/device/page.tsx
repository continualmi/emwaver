import Link from "next/link";
import { InformativeShell } from "@/components/InformativeShell";

export default function DevicePage() {
  return (
    <InformativeShell
      activeHref="/device"
      title="Current Device"
      description="EMWaver ships a single current-gen STM32 board, USB-only, designed around scripts + UI rather than reflashing loops."
    >
      <div className="grid gap-4 md:grid-cols-3">
        <a
          href="/_docs/hardware-catalog/hardware/pcb/PCB_emwaver_2025-12-09.pdf"
          target="_blank"
          rel="noreferrer"
          className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
        >
          <div className="text-xs font-semibold text-[color:var(--copper)]">PCB</div>
          <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">Open PCB PDF</div>
          <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Header orientation + routing details.</div>
        </a>
        <Link
          href="/pinout"
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
          <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">Order from JLCPCB</div>
          <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Download fabrication outputs.</div>
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
    </InformativeShell>
  );
}
