import { SiteHeader } from "@/components/emwaver/SiteHeader";

const RELEASE_DOWNLOAD_BASE = "https://github.com/continualmi/emwaver/releases/download/emwaver-preview";
const APP_STORE_URL = "https://apps.apple.com/us/app/emwaver/id6747035939";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.emwaver.emwaverandroidapp&hl=en-US&ah=xJ56ZZjMEPUbsS42586J-0pNhxQ";
const PLAY_INTERNAL_TEST_URL = "https://play.google.com/apps/internaltest/4701722111058615569";

type InstallAction = {
  label: string;
  href?: string;
  badge?: string;
  badgeAlt?: string;
  note?: string;
  muted?: boolean;
};

type PlatformCard = {
  platform: string;
  label: string;
  icon: string;
  accent: "aqua" | "sky";
  description: string;
  actions: InstallAction[];
};

const MOBILE_PLATFORMS: PlatformCard[] = [
  {
    platform: "iOS",
    label: "Primary",
    icon: "",
    accent: "aqua",
    description: "Install EMWaver on iPhone or iPad from the App Store.",
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
    icon: "▶",
    accent: "aqua",
    description: "Join the Google Play internal test to install through Play, or use the direct APK.",
    actions: [
      {
        label: "Join Google Play internal test",
        href: PLAY_INTERNAL_TEST_URL,
        badge: "/emwaver/badges/google-play.png",
        badgeAlt: "Get it on Google Play",
        note: "Join internal testing",
      },
      {
        label: "Open Play Store listing",
        href: PLAY_STORE_URL,
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

const DESKTOP_PLATFORMS: PlatformCard[] = [
  {
    platform: "macOS",
    label: "Dev & Advanced",
    icon: "Mac",
    accent: "sky",
    description: "Desktop build for firmware flashing, multi-device bench testing, and long automation runs.",
    actions: [
      {
        label: "Download DMG",
        href: `${RELEASE_DOWNLOAD_BASE}/EMWaver-macos.dmg`,
        badge: "/emwaver/badges/macos.png",
        badgeAlt: "Download for Mac",
      },
    ],
  },
  {
    platform: "Windows",
    label: "Preview",
    icon: "Win",
    accent: "sky",
    description: "Windows preview build for testing local EMWaver workflows on Windows 11.",
    actions: [
      {
        label: "Download EXE installer",
        href: `${RELEASE_DOWNLOAD_BASE}/EMWaverSetup-windows-x64.exe`,
        badge: "/emwaver/badges/windows.png",
        badgeAlt: "Available for Windows",
      },
      {
        label: "Download ZIP",
        href: `${RELEASE_DOWNLOAD_BASE}/EMWaver-windows-x64.zip`,
      },
    ],
  },
  {
    platform: "Linux",
    label: "Coming Soon",
    icon: "Linux",
    accent: "sky",
    description: "Linux packaging is planned after the V1 mobile launch.",
    actions: [
      {
        label: "Coming soon",
        muted: true,
      },
    ],
  },
];

function ActionButton({ action }: { action: InstallAction }) {
  if (action.badge) {
    const content = (
      <>
        <img
          src={action.badge}
          alt={action.badgeAlt || action.label}
          className="h-12 w-auto max-w-[210px] shrink-0 object-contain drop-shadow-[0_10px_24px_var(--shadow)]"
        />
        {action.note ? <span className="text-xs font-semibold text-[color:var(--ink-dim)]">{action.note}</span> : null}
      </>
    );

    if (!action.href) {
      return (
        <div className="inline-flex cursor-not-allowed flex-col items-start gap-1 opacity-70" aria-disabled="true">
          {content}
        </div>
      );
    }

    return (
      <a href={action.href} className="inline-flex flex-col items-start gap-1 no-underline transition hover:scale-[1.02]" target="_blank" rel="noreferrer">
        {content}
      </a>
    );
  }

  const className = [
    "inline-flex min-h-11 items-center justify-center rounded-xl border px-5 py-2.5 text-sm font-semibold no-underline transition",
    action.muted || !action.href
      ? "cursor-not-allowed border-dashed border-[color:var(--line)] bg-[color:var(--surface-2)] text-[color:var(--ink-dim)] opacity-70"
      : "border-[color:var(--line)] bg-[color:var(--surface-2)] text-[color:var(--ink)] hover:bg-[color:var(--surface-3)]",
  ].join(" ");

  if (!action.href) {
    return (
      <div className={className} aria-disabled="true">
        {action.label}
      </div>
    );
  }

  return (
    <a href={action.href} className={className} target="_blank" rel="noreferrer">
      {action.label}
    </a>
  );
}

function PlatformCardView({ platform }: { platform: PlatformCard }) {
  const accentClass = platform.accent === "aqua" ? "text-[color:var(--aqua)]" : "text-[color:var(--sky)]";

  return (
    <div className="flex h-full flex-col rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface-2)] text-base font-semibold text-[color:var(--ink)]">
          {platform.icon}
        </div>
        <div>
          <div className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${accentClass}`}>
            {platform.platform} — {platform.label}
          </div>
          <p className="pt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
            {platform.description}
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        {platform.actions.map((action) => (
          <ActionButton key={action.label} action={action} />
        ))}
      </div>
    </div>
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
              available for development and advanced use. Windows preview downloads are available,
              with Linux planned after V1.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {["App Store", "Google Play internal test", "Android APK", "macOS DMG", "Windows EXE", "Windows ZIP", "Linux coming soon"].map((label) => (
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
            {MOBILE_PLATFORMS.map((platform) => (
              <PlatformCardView key={platform.platform} platform={platform} />
            ))}
          </div>
        </section>

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
            {DESKTOP_PLATFORMS.map((platform) => (
              <PlatformCardView key={platform.platform} platform={platform} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
