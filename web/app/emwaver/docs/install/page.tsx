import Link from "next/link";

function PreviewDownloads() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <a
        href="/emwaver/downloads/EMWaver-android.apk"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Android</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">APK</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Direct preview build.</div>
      </a>

      <a
        href="/emwaver/downloads/EMWaver-macos.dmg"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">macOS</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">DMG</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Desktop preview build.</div>
      </a>

      <a
        href="/emwaver/downloads/EMWaver-windows-x64.zip"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Windows</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">ZIP with EXE</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Windows x64 preview package.</div>
      </a>
    </div>
  );
}

function StoreBadges() {
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
      {[
        ["iOS", "App Store", "iPhone and iPad coming soon."],
        ["macOS", "App Store", "Store listing coming soon."],
        ["Android", "Google Play", "Store listing coming soon."],
        ["Windows", "Microsoft Store", "Store listing coming soon."],
      ].map(([platform, store, description]) => (
        <div
          key={platform}
          className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5"
        >
          <div className="text-xs font-semibold text-[color:var(--ink-dim)]">{platform}</div>
          <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">{store}</div>
          <div className="pt-2 text-sm text-[color:var(--ink-dim)]">{description}</div>
          <div className="pt-4 text-sm font-semibold text-[color:var(--ink-dim)]">Coming soon</div>
        </div>
      ))}
    </div>
  );
}


export default function InstallDocPage() {
  return (
    <>
      <h1>Install and run locally</h1>
      <p>
        Get the EMWaver app, connect your board, and start running scripts.
      </p>

      <h2>1. Install the app</h2>
      <p>
        Download the Android, macOS, or Windows preview build directly. Store listings are coming soon.
      </p>
      <PreviewDownloads />

      <h3>Stores</h3>
      <StoreBadges />

      <h2>2. Get a supported board</h2>
      <p>
        You can build one from our{" "}
        <Link href="/emwaver/docs/hardware">open-source hardware repos</Link> or use a compatible
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
          <Link href="/emwaver/docs/hardware">hardware docs</Link> and on the{" "}
          <Link href="/emwaver/build">Build page</Link>.
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

      <h2>4. Run local scripts</h2>
      <p>
        Open the Scripts view in the app, pick a built-in script or create your own <code>.emw</code> file,
        and press Run. Local script execution should not require sign-in, cloud activation, or a hosted relay.
      </p>

      <h2>5. Use the localhost gateway</h2>
      <p>
        On desktop, you can also start the browser gateway:
      </p>
      <pre><code>{`emwaver gateway --port 3921`}</code></pre>
      <p>
        Then open <code>http://127.0.0.1:3921</code>. The gateway controls the local native app on the
        same machine; the app owns script execution and USB/device transport.
      </p>

      <h2>6. Optional Agent key</h2>
      <p>
        The paid Agent can use an API key to help write and debug scripts, but that key should not be required
        for ordinary local hardware control. See the{" "}
        <Link href="/emwaver/docs/scripts">scripting guide</Link> for script details.
      </p>
    </>
  );
}
