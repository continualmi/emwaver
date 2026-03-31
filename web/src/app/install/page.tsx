import { SiteHeader } from "@/components/SiteHeader";

const STORES = [
  {
    platform: "iOS",
    name: "App Store",
    description: "iPhone and iPad.",
    href: "https://apps.apple.com/app/emwaver",
    badge: "/badges/app-store.png",
  },
  {
    platform: "macOS",
    name: "App Store",
    description: "Native desktop app.",
    href: "https://apps.apple.com/app/emwaver",
    badge: "/badges/macos.png",
  },
  {
    platform: "Android",
    name: "Google Play",
    description: "Mobile app.",
    href: "https://play.google.com/store/apps/details?id=com.emwaver.app",
    badge: "/badges/google-play.png",
  },
  {
    platform: "Windows",
    name: "Microsoft Store",
    description: "Desktop app.",
    href: "https://apps.microsoft.com/search?query=EMWaver",
    badge: "/badges/windows.png",
  },
];

export default function InstallPage() {
  return (
    <div className="install-mode relative min-h-dvh overflow-x-clip">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.18),rgba(245,246,248,0.28))]" />
        <div className="absolute inset-0 bg-[radial-gradient(800px_500px_at_50%_0%,var(--aqua-tint-2),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(700px_480px_at_85%_18%,var(--sky-tint),transparent_62%)]" />
      </div>

      <SiteHeader />

      <main className="mx-auto max-w-5xl px-5 pt-16 pb-20">
        <section className="grid gap-8 rounded-[2rem] border border-[color:var(--line)] bg-[color:var(--glass)] px-6 py-7 shadow-[0_24px_70px_var(--shadow)] md:grid-cols-[auto_1fr] md:items-center md:px-8 md:py-8">
          <div className="flex justify-center md:justify-start">
            <img
              src="/app-icon.png"
              alt="EMWaver app icon"
              className="h-28 w-28 rounded-[1.75rem] border border-[color:var(--line)] shadow-[0_16px_48px_var(--shadow-heavy)]"
            />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--sky)]">
              Store installs
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">
              Install EMWaver on the device you already use.
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[color:var(--ink-dim)]">
              Same account, same scripts, same hardware workflow. Install the native app for your
              platform, sign in, and connect a supported board.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {["iPhone + iPad", "macOS", "Android", "Windows"].map((label) => (
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
                Official store builds
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-[color:var(--ink-dim)]">
              EMWaver is distributed through the platform-native store for each supported operating system.
            </p>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {STORES.map((store) => (
            <a
              key={store.platform}
              href={store.href}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center justify-between gap-4 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 no-underline transition hover:bg-[color:var(--surface-2)]"
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
              <div className="text-sm font-semibold text-[color:var(--ink-dim)] transition group-hover:text-[color:var(--ink)]">
                Open
              </div>
            </a>
          ))}
          </div>
        </section>

        <section className="mt-10 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--aqua)]">
              Sign in
            </div>
            <p className="mt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
              Browser sign-in and native app access both route through your Continual account.
            </p>
          </div>
          <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--sky)]">
              Connect hardware
            </div>
            <p className="mt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
              Plug in a supported board and let EMWaver handle activation, updates, and script runtime.
            </p>
          </div>
          <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--copper)]">
              Start exploring
            </div>
            <p className="mt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
              Move from install to scripts, cloud sync, and Agent-assisted hardware workflows in the same app.
            </p>
          </div>
        </section>
      </main>

    </div>
  );
}
