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
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">iOS / macOS</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">App Store</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Install on iPhone, iPad, and Mac.</div>
      </a>

      <a
        href="https://apps.microsoft.com/search?query=EMWaver"
        target="_blank"
        rel="noreferrer"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Windows</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">Microsoft Store</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Install the desktop app.</div>
      </a>
    </div>
  );
}

export default function InstallDocPage() {
  return (
    <>
      <h1>Install & connect</h1>
      <p>Install the apps, connect to your device, and run scripts with UI.</p>

      <h2>Install</h2>
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
    </>
  );
}
