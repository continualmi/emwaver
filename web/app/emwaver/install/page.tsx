import { SiteHeader } from "@/components/emwaver/SiteHeader";

const RELEASE_DOWNLOAD_BASE = "https://github.com/continualmi/emwaver/releases/latest/download";

const MOBILE_STORES = [
  {
    platform: "iOS",
    name: "App Store",
    description: "iPhone and iPad coming soon.",
    badge: "/emwaver/badges/app-store.png",
  },
  {
    platform: "Android",
    name: "Google Play",
    description: "Store listing coming soon. APK is also available.",
    badge: "/emwaver/badges/google-play.png",
  },
];

const DIRECT_DOWNLOADS = [
  {
    platform: "Android",
    name: "APK",
    description: "Direct Android preview build.",
    href: `${RELEASE_DOWNLOAD_BASE}/EMWaver-android.apk`,
  },
  {
    platform: "macOS",
    name: "DMG",
    description: "Desktop preview build for macOS.",
    href: `${RELEASE_DOWNLOAD_BASE}/EMWaver-macos.dmg`,
  },
  {
    platform: "Windows",
    name: "Installer EXE",
    description: "Recommended Windows x64 installer.",
    href: `${RELEASE_DOWNLOAD_BASE}/EMWaverSetup-windows-x64.exe`,
  },
  {
    platform: "Windows",
    name: "ZIP with EXE",
    description: "Portable Windows x64 package containing EMWaver.exe.",
    href: `${RELEASE_DOWNLOAD_BASE}/EMWaver-windows-x64.zip`,
  },
];

export default function InstallPage() {
  return (
    <div className="install-mode relative min-h-dvh overflow-x-clip">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(800px_500px_at_50%_0%,var(--aqua-tint-2),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(700px_480px_at_85%_18%,var(--sky-tint),transparent_62%)]" />
      </div>

      <SiteHeader />

      <main className="mx-auto max-w-5xl px-5 pt-16 pb-20">
        <section className="grid gap-8 rounded-[2rem] border border-[color:var(--line)] bg-[color:var(--glass)] px-6 py-7 shadow-[0_24px_70px_var(--shadow)] md:grid-cols-[auto_1fr] md:items-center md:px-8 md:py-8">
          <div className="flex justify-center md:justify-start">
            <img
              src="/emwaver/app-icon.png"
              alt="EMWaver app icon"
              className="h-28 w-28 rounded-[1.75rem] border border-[color:var(--line)] shadow-[0_16px_48px_var(--shadow-heavy)]"
            />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--sky)]">
              Direct downloads
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">
              Install EMWaver on the device you already use.
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[color:var(--ink-dim)]">
              Install the native app for your platform, connect a supported board, and run
              local scripts without an EMWaver account or cloud activation.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {["macOS", "Android", "Windows"].map((label) => (
                <div
                  key={label}
                  className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1.5 text-xs font-medium text-[color:var(--ink-dim)]"
                >
                  {label}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-10">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--aqua)]">
                Choose a platform
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--ink)]">
                Download EMWaver
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-[color:var(--ink-dim)]">
              Desktop and mobile builds are available directly.
            </p>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
          {DIRECT_DOWNLOADS.map((download) => (
            <a
              key={`${download.platform}-${download.name}`}
              href={download.href}
              className="group rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 no-underline transition hover:bg-[color:var(--surface-2)]"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-dim)]">
                {download.platform}
              </div>
              <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
                {download.name}
              </div>
              <div className="pt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
                {download.description}
              </div>
              <div className="pt-4 text-sm font-semibold text-[color:var(--ink-dim)] transition group-hover:text-[color:var(--ink)]">
                Download
              </div>
            </a>
          ))}
          </div>
        </section>

        <section className="mt-10">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--sky)]">
                Mobile stores
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--ink)]">
                Coming soon
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-[color:var(--ink-dim)]">
              iPhone, iPad, and Android store listings are planned after the preview build track is ready.
            </p>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {MOBILE_STORES.map((store) => (
              <div
                key={store.platform}
                className="flex items-center justify-between gap-4 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5"
              >
                <div className="flex items-center gap-4">
                  <img
                    src={store.badge}
                    alt={`${store.platform} badge`}
                    className="h-12 w-auto max-w-[8rem] shrink-0 object-contain"
                  />
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-dim)]">
                      {store.platform}
                    </div>
                    <div className="pt-1 text-lg font-semibold text-[color:var(--ink)]">
                      {store.name}
                    </div>
                    <div className="pt-0.5 text-sm text-[color:var(--ink-dim)]">
                      {store.description}
                    </div>
                  </div>
                </div>
                <div className="text-sm font-semibold text-[color:var(--ink-dim)]">
                  Coming soon
                </div>
              </div>
            ))}
          </div>
        </section>

      </main>

    </div>
  );
}
