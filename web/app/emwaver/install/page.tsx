import { SiteHeader } from "@/components/emwaver/SiteHeader";

const RELEASE_DOWNLOAD_BASE = "https://github.com/continualmi/emwaver/releases/latest/download";

const MOBILE_PLATFORMS = [
  {
    platform: "iOS",
    label: "Primary",
    badge: "/emwaver/badges/app-store.png",
    badgeAlt: "App Store badge",
    description: "Available now via TestFlight. App Store listing coming soon.",
    downloadLabel: "iPhone & iPad",
    downloadHref: undefined,
    downloadCta: "TestFlight",
  },
  {
    platform: "Android",
    label: "Primary",
    badge: "/emwaver/badges/google-play.png",
    badgeAlt: "Google Play badge",
    description: "Google Play listing coming soon.",
    downloadLabel: "APK preview build",
    downloadHref: `${RELEASE_DOWNLOAD_BASE}/EMWaver-android.apk`,
    downloadCta: "Download APK",
    downloadBadge: "/emwaver/badges/android-apk.png",
  },
];

const DESKTOP_PLATFORMS = [
  {
    platform: "macOS",
    label: "Dev & Advanced",
    description: "Desktop build for firmware flashing, multi-device bench testing, and long automation runs.",
    downloadLabel: "DMG preview build",
    downloadHref: `${RELEASE_DOWNLOAD_BASE}/EMWaver-macos.dmg`,
    downloadCta: "Download DMG",
    badge: "/emwaver/badges/macos.png",
  },
];

export default function InstallPage() {
  return (
    <div className="install-mode relative min-h-dvh overflow-x-clip">
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
              Install
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">
              Your phone is now an electronics lab.
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[color:var(--ink-dim)]">
              Install EMWaver on iOS or Android, connect a supported board via USB-C,
              and run local scripts without accounts or cloud activation. macOS is also
              available for development and advanced use.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {["iOS", "Android", "macOS"].map((label) => (
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

        {/* Mobile — primary */}
        <section className="mt-10">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--aqua)]">
                Mobile
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--ink)]">
                Get EMWaver on your phone
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-[color:var(--ink-dim)]">
              iOS and Android are the primary EMWaver platforms.
            </p>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {MOBILE_PLATFORMS.map((p) => (
              <div
                key={p.platform}
                className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5"
              >
                <div className="flex items-center gap-3">
                  <img
                    src={p.badge}
                    alt={p.badgeAlt}
                    className="h-10 w-auto shrink-0 object-contain"
                  />
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--aqua)]">
                      {p.platform} — {p.label}
                    </div>
                    <div className="pt-0.5 text-sm text-[color:var(--ink-dim)]">
                      {p.description}
                    </div>
                  </div>
                </div>
                {p.downloadHref ? (
                  <a
                    href={p.downloadHref}
                    className="mt-4 flex items-center justify-center gap-3 w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-4 py-3 text-sm font-semibold text-[color:var(--ink)] no-underline transition hover:bg-[color:var(--surface-3)]"
                  >
                    {p.downloadBadge && (
                      <img src={p.downloadBadge} alt="" className="h-7 w-auto shrink-0" />
                    )}
                    {p.downloadCta}
                  </a>
                ) : (
                  <div className="mt-4 w-full rounded-xl border border-dashed border-[color:var(--line)] bg-[color:var(--surface-2)] px-4 py-2.5 text-center text-sm font-semibold text-[color:var(--ink-dim)]">
                    {p.downloadCta}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Desktop */}
        <section className="mt-10">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--sky)]">
                Desktop
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--ink)]">
                Also available on macOS
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-[color:var(--ink-dim)]">
              For firmware flashing, multi-device bench testing, and advanced development.
            </p>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-1 lg:grid-cols-1">
            {DESKTOP_PLATFORMS.map((p) => (
              <div
                key={p.platform}
                className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)]">
                    <img
                      src={p.badge}
                      alt={p.platform}
                      className="h-6 w-6 object-contain"
                    />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--sky)]">
                      {p.platform} — {p.label}
                    </div>
                    <div className="pt-0.5 text-sm text-[color:var(--ink-dim)]">
                      {p.description}
                    </div>
                  </div>
                </div>
                {p.downloadHref ? (
                  <a
                    href={p.downloadHref}
                    className="mt-4 inline-flex items-center justify-center w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-4 py-2.5 text-sm font-semibold text-[color:var(--ink)] no-underline transition hover:bg-[color:var(--surface-3)]"
                  >
                    {p.downloadCta}
                  </a>
                ) : (
                  <div className="mt-4 w-full rounded-xl border border-dashed border-[color:var(--line)] bg-[color:var(--surface-2)] px-4 py-2.5 text-center text-sm font-semibold text-[color:var(--ink-dim)]">
                    {p.downloadCta}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
