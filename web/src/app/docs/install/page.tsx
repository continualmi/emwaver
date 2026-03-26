import Link from "next/link";

function StoreBadges() {
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
      <a
        href="https://apps.apple.com/app/emwaver"
        target="_blank"
        rel="noreferrer"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">iOS</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">App Store</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">iPhone and iPad.</div>
      </a>

      <a
        href="https://apps.apple.com/app/emwaver"
        target="_blank"
        rel="noreferrer"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">macOS</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">App Store</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Native desktop app.</div>
      </a>

      <a
        href="https://play.google.com/store/apps/details?id=com.emwaver.app"
        target="_blank"
        rel="noreferrer"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Android</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">Google Play</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Mobile app.</div>
      </a>

      <a
        href="https://apps.microsoft.com/search?query=EMWaver"
        target="_blank"
        rel="noreferrer"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Windows</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">Microsoft Store</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Desktop app.</div>
      </a>
    </div>
  );
}

export default function InstallDocPage() {
  return (
    <>
      <h1>Install &amp; activate</h1>
      <p>
        Get the EMWaver app, connect your board, and start running scripts.
      </p>

      <h2>1. Install the app</h2>
      <StoreBadges />

      <h2>2. Get a supported board</h2>
      <p>
        You can build one from our{" "}
        <Link href="/docs/hardware">open-source hardware repos</Link> or use a compatible
        off-the-shelf board:
      </p>
      <ul>
        <li>
          <strong>ESP32-S3 dev board</strong> — supported directly by EMWaver, so you can get
          started without building anything from the lineup.
        </li>
        <li>
          <strong>EMWaver Shield</strong> (ESP32-S3) — a shield-style carrier for an ESP32-S3
          dev module, with IR TX/RX, radio-module support, and expanded headers.{" "}
          <a href="https://github.com/continualmi/emwaver-shield" target="_blank" rel="noreferrer">
            Build files on GitHub
          </a>
          .
        </li>
        <li>
          <strong>EMWaver lineup</strong> — optional custom EMWaver devices and modules are listed in the{" "}
          <Link href="/docs/hardware">hardware docs</Link> and on the{" "}
          <Link href="/build">Build page</Link>.
        </li>
      </ul>

      <h2>3. Connect</h2>
      <ul>
        <li>Plug the board into your phone (USB-C) or desktop (USB).</li>
        <li>Open the EMWaver app — the device should appear automatically.</li>
      </ul>
      <blockquote>
        The board communicates over USB MIDI SysEx. No drivers needed — it enumerates as a
        standard USB MIDI device.
      </blockquote>

      <h2>4. Sign in</h2>
      <p>
        Sign in with your account. Sign-in is available even without a device connected, so you
        can authenticate first and plug in your board after.
      </p>

      <h2>5. Activate</h2>
      <p>
        When you connect a new board, the app reads its hardware UID, identifies the board type,
        and activates it on the platform. The app handles firmware flashing automatically —
        you don&apos;t need to build or flash anything manually.
      </p>
      <p>
        If you re-flash the same physical board later, the platform restores its existing
        activation automatically.
      </p>

      <h2>6. Run scripts</h2>
      <p>
        Once activated, go to the Scripts tab, pick a built-in script (or create your own), and
        press Run. See the{" "}
        <Link href="/docs/scripts">scripting guide</Link> for details.
      </p>
    </>
  );
}
