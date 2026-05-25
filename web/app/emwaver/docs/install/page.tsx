import Link from "next/link";

const RELEASE_DOWNLOAD_BASE = "https://github.com/continualmi/emwaver/releases/latest/download";
const APP_STORE_URL = "https://apps.apple.com/us/app/emwaver/id6747035939";
const PLAY_INTERNAL_TEST_URL = "https://play.google.com/apps/internaltest/4701722111058615569";

type BadgeLink = {
  label: string;
  href: string;
  badge: string;
  badgeAlt: string;
  note?: string;
};

type FileDownload = {
  label: string;
  href: string;
  ext: string;
  detail: string;
};

function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3v11m0 0 4-4m-4 4-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function BadgeDownload({ item }: { item: BadgeLink }) {
  return (
    <a
      href={item.href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex flex-col items-start gap-2 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4 no-underline transition hover:bg-[color:var(--surface-2)]"
    >
      <img
        src={item.badge}
        alt={item.badgeAlt}
        className="h-12 w-auto max-w-[220px] object-contain drop-shadow-[0_10px_24px_var(--shadow)]"
      />
      <div>
        <div className="text-sm font-semibold text-[color:var(--ink)]">{item.label}</div>
        {item.note ? <div className="mt-1 text-xs leading-5 text-[color:var(--ink-dim)]">{item.note}</div> : null}
      </div>
    </a>
  );
}

function FileDownloadCard({ item }: { item: FileDownload }) {
  return (
    <a
      href={item.href}
      target="_blank"
      rel="noreferrer"
      className="group inline-flex min-h-16 items-center gap-3 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-4 py-3 text-left text-[color:var(--ink)] no-underline transition hover:bg-[color:var(--surface-3)]"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--sky-tint-2)] text-[color:var(--sky)] transition group-hover:bg-[color:var(--sky-tint)]">
        <DownloadIcon />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <span>{item.label}</span>
          <span className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface-3)] px-2 py-0.5 text-[10px] font-bold tracking-[0.12em] text-[color:var(--sky)]">
            .{item.ext}
          </span>
        </div>
        <div className="mt-1 text-xs leading-5 text-[color:var(--ink-dim)]">{item.detail}</div>
      </div>
    </a>
  );
}

function PlatformPanel({
  eyebrow,
  title,
  description,
  badge,
  badgeAlt,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  badge?: string;
  badgeAlt?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--sky)]">{eyebrow}</div>
          <div className="mt-2 text-lg font-semibold text-[color:var(--ink)]">{title}</div>
          <p className="mt-2 text-sm leading-6 text-[color:var(--ink-dim)]">{description}</p>
        </div>
        {badge ? (
          <div className="rounded-2xl border border-[color:var(--line)] bg-black/45 px-4 py-3">
            <img src={badge} alt={badgeAlt || title} className="h-11 w-auto max-w-[210px] object-contain opacity-95" />
          </div>
        ) : null}
      </div>
      <div className="mt-5 flex flex-wrap gap-3">{children}</div>
    </div>
  );
}

function InstallOptions() {
  const mobile: BadgeLink[] = [
    {
      label: "iPhone and iPad",
      href: APP_STORE_URL,
      badge: "/emwaver/badges/app-store.png",
      badgeAlt: "Download on the App Store",
      note: "Primary iOS install path.",
    },
    {
      label: "Android through Google Play",
      href: PLAY_INTERNAL_TEST_URL,
      badge: "/emwaver/badges/google-play.png",
      badgeAlt: "Get it on Google Play",
      note: "Join the internal test.",
    },
    {
      label: "Android direct download",
      href: `${RELEASE_DOWNLOAD_BASE}/EMWaver-android.apk`,
      badge: "/emwaver/badges/android-apk.png",
      badgeAlt: "Download Android APK",
      note: "Direct APK outside Google Play.",
    },
  ];

  return (
    <div className="grid gap-4">
      <div>
        <h3 className="mt-0">Mobile apps</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {mobile.map((item) => <BadgeDownload key={item.label} item={item} />)}
        </div>
      </div>

      <div>
        <h3>Desktop downloads</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <PlatformPanel
            eyebrow="macOS — Dev & Advanced"
            title="macOS app"
            description="For firmware flashing, multi-device bench testing, and long automation runs."
            badge="/emwaver/badges/macos.png"
            badgeAlt="Available for Mac"
          >
            <FileDownloadCard
              item={{
                label: "Download macOS app",
                href: `${RELEASE_DOWNLOAD_BASE}/EMWaver-macos.dmg`,
                ext: "DMG",
                detail: "Disk image installer",
              }}
            />
          </PlatformPanel>

          <PlatformPanel
            eyebrow="Windows — Preview"
            title="Windows app"
            description="Preview build for testing local EMWaver workflows on Windows 11."
            badge="/emwaver/badges/windows.png"
            badgeAlt="Available for Windows"
          >
            <FileDownloadCard
              item={{
                label: "Download installer",
                href: `${RELEASE_DOWNLOAD_BASE}/EMWaverSetup-windows-x64.exe`,
                ext: "EXE",
                detail: "Recommended Windows installer",
              }}
            />
            <FileDownloadCard
              item={{
                label: "Download portable package",
                href: `${RELEASE_DOWNLOAD_BASE}/EMWaver-windows-x64.zip`,
                ext: "ZIP",
                detail: "Portable build archive",
              }}
            />
          </PlatformPanel>
        </div>
      </div>

      <div className="rounded-2xl border border-dashed border-[color:var(--line)] bg-[color:var(--surface)] p-5 opacity-75">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-dim)]">Linux</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">In progress</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">The native Linux app port is underway. Public packages are not available yet.</div>
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
        Android is available through the Google Play internal test and as a direct APK download. macOS and Windows
        downloads are available for desktop use. The native Linux app is in progress.
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

      <h2>3. Flash the EMWaver firmware</h2>
      <p>
        A supported board must be running the fixed EMWaver firmware for its target before the apps can
        control hardware. Use the bundled firmware image for your board class — ESP32-S3 or STM32F042.
        Do not build custom firmware as part of the normal setup flow.
      </p>
      <ul>
        <li><strong>Pre-flashed board</strong>: skip this step and connect directly.</li>
        <li><strong>Blank or stock board</strong>: use the EMWaver app's firmware setup/update flow where available.</li>
        <li><strong>Desktop setup</strong>: use macOS for one-time firmware setup when a phone cannot flash the board directly.</li>
      </ul>
      <blockquote>
        The firmware is platform-managed and fixed for supported targets. Users should not need ESP-IDF,
        STM32CubeIDE, Arduino, or a manual compile/upload loop for normal EMWaver use.
      </blockquote>

      <h2>4. Connect</h2>
      <ul>
        <li>Plug the flashed board into your phone (USB-C) or desktop (USB).</li>
        <li>Open the EMWaver app — the device should appear automatically.</li>
      </ul>
      <blockquote>
        The board communicates over USB MIDI SysEx. No drivers needed — it enumerates as a
        standard USB MIDI device.
      </blockquote>

      <h2>5. Run local scripts</h2>
      <p>
        Open the Scripts view in the app, pick a built-in script or create your own <code>.js</code> file,
        and press Run. Scripts can include JSX-style UI syntax for native module panels.
      </p>

      <h2>6. Optional Agent key</h2>
      <p>
        The optional Agent can use an API key to inspect hardware through primitive tools, probe modules,
        and help write or debug scripts. The local script runtime works without Agent access. See the{" "}
        <Link href="/emwaver/docs/scripts">scripting guide</Link> for script details.
      </p>
    </>
  );
}
