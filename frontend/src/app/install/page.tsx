import { InformativeShell } from "@/components/InformativeShell";

function StoreBadges() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <a
        href="https://play.google.com/store/apps/details?id=com.emwaver.app"
        target="_blank"
        rel="noreferrer"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Android</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">Google Play</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Install the mobile app.</div>
      </a>

      <a
        href="https://apps.apple.com/app/emwaver"
        target="_blank"
        rel="noreferrer"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">iOS</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">App Store</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Install the mobile app.</div>
      </a>

      <a
        href="https://github.com/luispl77/emwaver/releases/latest"
        target="_blank"
        rel="noreferrer"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Desktop</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">Downloads</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Windows / macOS / Linux.</div>
      </a>
    </div>
  );
}

export default function InstallPage() {
  return (
    <InformativeShell
      activeHref="/install"
      title="Installing & Using"
      description="Install the apps, connect over USB, and run scripts with UI."
    >
      <h2>Download</h2>
      <StoreBadges />

      <h2>Connect</h2>
      <ul>
        <li>Plug the board into your phone (USB-C) or desktop</li>
        <li>Open EMWaver and connect to the device</li>
      </ul>

      <h2>Run scripts</h2>
      <ul>
        <li>Create or open a script</li>
        <li>Press Run to get the UI + device workflow</li>
      </ul>
    </InformativeShell>
  );
}
