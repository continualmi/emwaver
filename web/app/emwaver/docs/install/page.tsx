import Link from "next/link";

function PreviewDownloads() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <a
        href="/emwaver/downloads/EMWaver-linux-x64.tar.gz"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Linux</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">CLI + Gateway</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Primary Linux method for browser rendering and daemon hardware transport.</div>
      </a>

      <a
        href="/emwaver/downloads/EMWaver-macos-cli.tar.gz"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">macOS</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">CLI + Gateway</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Command-line gateway and daemon package.</div>
      </a>

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
        href="/emwaver/downloads/EMWaverSetup-windows-x64.exe"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Windows</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">Installer EXE</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Recommended Windows x64 installer.</div>
      </a>

      <a
        href="/emwaver/downloads/EMWaver-windows-x64.zip"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Windows</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">ZIP with EXE</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Portable Windows x64 package.</div>
      </a>
    </div>
  );
}

function MobileStoreBadges() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {[
        ["iOS", "App Store", "iPhone and iPad coming soon."],
        ["Android", "Google Play", "Store listing coming soon. APK is also available."],
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
        Get the EMWaver app or CLI, connect your board, and start running scripts.
      </p>

      <h2>1. Install the app or CLI</h2>
      <p>
        Linux is CLI-first: use the CLI/gateway tarball to start the local browser experience and
        daemon-backed hardware runtime. macOS can use either the native DMG or CLI package. Windows
        currently uses the installer EXE or portable ZIP, with CLI parity planned.
      </p>
      <PreviewDownloads />

      <h3>Mobile stores</h3>
      <MobileStoreBadges />

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
        On Linux, the CLI is the primary desktop/server method. It starts the localhost browser
        gateway for rendering the full script UI and connects it to a local daemon that owns
        USB MIDI/SysEx or ESP32 BLE transport underneath:
      </p>
      <pre><code>{`emwaver start
emwaver start --ble
emwaver start --device 0`}</code></pre>
      <p>
        Then open <code>http://127.0.0.1:3921</code>. The gateway renders the script UI in the browser;
        the daemon handles script execution, UI events, and local BLE/USB transport using the shared
        EMWaver protocol. The same command-line path also works for macOS CLI workflows.
      </p>
      <p>
        Advanced users can split the stack when they want the daemon to run separately from the browser gateway:
      </p>
      <pre><code>{`emwaver gateway --daemon-fallback --ble
emwaver daemon start --ble
emwaver service install --ble`}</code></pre>
      <p>
        A running native desktop app can still connect to the same gateway and take priority as the
        runtime owner. Otherwise the daemon is the fallback runtime owner for headless Linux and CLI use.
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
