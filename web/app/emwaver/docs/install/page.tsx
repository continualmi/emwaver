import Link from "next/link";

const RELEASE_DOWNLOAD_BASE = "https://github.com/continualmi/emwaver/releases/download/emwaver-preview";
const APP_STORE_URL = "https://apps.apple.com/us/app/emwaver/id6747035939";
const PLAY_INTERNAL_TEST_URL = "https://play.google.com/apps/internaltest/4701722111058615569";

function InstallOptions() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <a
        href={APP_STORE_URL}
        target="_blank"
        rel="noreferrer"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">iOS — Primary</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">App Store</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Install EMWaver on iPhone or iPad through the App Store.</div>
      </a>

      <a
        href={PLAY_INTERNAL_TEST_URL}
        target="_blank"
        rel="noreferrer"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Android — Primary</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">Google Play internal test</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Join internal testing to install EMWaver through Google Play.</div>
      </a>

      <a
        href={`${RELEASE_DOWNLOAD_BASE}/EMWaver-android.apk`}
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Android — Direct</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">APK</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Direct APK download outside Google Play.</div>
      </a>

      <a
        href={`${RELEASE_DOWNLOAD_BASE}/EMWaver-macos.dmg`}
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">macOS — Dev & Advanced</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">DMG</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">For firmware flashing, multi-device bench testing, and advanced development.</div>
      </a>

      <div className="rounded-2xl border border-dashed border-[color:var(--line)] bg-[color:var(--surface)] p-5 opacity-75">
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Windows</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">Coming soon</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Windows support is planned after the V1 mobile launch.</div>
      </div>

      <div className="rounded-2xl border border-dashed border-[color:var(--line)] bg-[color:var(--surface)] p-5 opacity-75">
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Linux</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">Coming soon</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Linux packaging is planned after the V1 mobile launch.</div>
      </div>
    </div>
  );
}


export default function InstallDocPage() {
  return (
    <>
      <h1>Install and run locally</h1>
      <p>
        Get the EMWaver app on your phone, connect your board, and start running scripts.
      </p>

      <h2>1. Install the app</h2>
      <p>
        iOS and Android are the primary EMWaver platforms. iOS is available through the App Store.
        Android is available through the Google Play internal test and as a direct APK download. macOS is available
        for development and advanced use, and Windows and Linux are coming soon after V1.
      </p>
      <InstallOptions />

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

      <h2>5. Optional Agent key</h2>
      <p>
        The paid Agent can use an API key to help write and debug scripts, but that key should not be required
        for ordinary local hardware control. See the{" "}
        <Link href="/emwaver/docs/scripts">scripting guide</Link> for script details.
      </p>

    </>
  );
}
