import { SiteHeader } from "@/components/emwaver/SiteHeader";

const RELEASE_DOWNLOAD_BASE = "https://github.com/continualmi/emwaver/releases/download/emwaver-preview";
const APP_STORE_URL = "https://apps.apple.com/us/app/emwaver/id6747035939";

const MOBILE_PLATFORMS = [
  {
    platform: "iOS",
    label: "Primary",
    badge: "/emwaver/badges/app-store.png",
    badgeAlt: "Download on the App Store",
    description: "Available on the App Store for iPhone and iPad.",
    actions: [
      {
        label: "Download on the App Store",
        href: APP_STORE_URL,
        badge: "/emwaver/badges/app-store.png",
        badgeAlt: "Download on the App Store",
      },
    ],
  },
  {
    platform: "Android",
    label: "Primary",
    badge: "/emwaver/badges/google-play.png",
    badgeAlt: "Get it on Google Play",
    description: "Use the direct APK today. Google Play is prepared for the public listing.",
    actions: [
      {
        label: "Get it on Google Play",
        href: undefined,
        badge: "/emwaver/badges/google-play.png",
        badgeAlt: "Get it on Google Play",
        comingSoon: true,
      },
      {
        label: "Download APK",
        href: `${RELEASE_DOWNLOAD_BASE}/EMWaver-android.apk`,
        badge: "/emwaver/badges/android-apk.png",
        badgeAlt: "Download Android APK",
      },
    ],
  },
];

const DESKTOP_PLATFORMS = [
  {
    platform: "macOS",
    label: "Dev & Advanced",
    description: "Desktop build for firmware flashing, multi-device bench testing, and long automation runs.",
    badge: "/emwaver/badges/macos.png",
    actions: [
      {
        label: "Download DMG",
        href: `${RELEASE_DOWNLOAD_BASE}/EMWaver-macos.dmg`,
      },
    ],
  },
  {
    platform: "Windows",
    label: "Coming Soon",
    description: "Windows support is planned after the V1 mobile launch.",
    badge: undefined,
    actions: [
      {
        label: "Coming soon",
        href: undefined,
        comingSoon: true,
      },
    ],
  },
];

function ActionButton({ action }: { action: { label: string; href?: string; badge?: string; badgeAlt?: string; comingSoon?: boolean } }) {
  const className = "flex min-h-12 items-center justify-center gap-3 rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-4 py-3 text-sm font-semibold text-[color:var(--ink)] no-underline transition hover:bg-[color:var(--surface-3)]";

  const content = (
    <>
      {action.badge ? (
        <img src={action.badge} alt={action.badgeAlt || ""} className="h-9 w-auto shrink-0 object-contain" />
      ) : null}
      {!action.badge ? action.label : null}
      {action.comingSoon ? <span className="text-xs text-[color:var(--ink-dim)]">Coming soon</span> : null}
    </>
  );

  if (!action.href) {
    return (
      <div className={`${className} cursor-not-allowed border-dashed opacity-70`} aria-disabled="true">
        {content}
      </div>
    );
  }

  return (
    <a href={action.href} className={className} target="_blank" rel="noreferrer">
      {content}
    </a>
  );
}

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
              available for development and advanced use, with Windows planned after V1.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {["App Store", "Android APK", "Google Play", "macOS DMG", "Windows coming soon"].map((label) => (
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
                <div className="mt-4 grid gap-3">
                  {p.actions.map((action) => (
                    <ActionButton key={action.label} action={action} />
                  ))}
                </div>
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
                Desktop downloads
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-[color:var(--ink-dim)]">
              For firmware flashing, multi-device bench testing, and advanced development.
            </p>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {DESKTOP_PLATFORMS.map((p) => (
              <div
                key={p.platform}
                className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] text-sm font-semibold text-[color:var(--ink)]">
                    {p.badge ? (
                      <img
                        src={p.badge}
                        alt={p.platform}
                        className="h-6 w-6 object-contain"
                      />
                    ) : (
                      "Win"
                    )}
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
                <div className="mt-4 grid gap-3">
                  {p.actions.map((action) => (
                    <ActionButton key={action.label} action={action} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
