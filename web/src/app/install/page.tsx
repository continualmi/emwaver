import { SiteFooter } from "@/components/SiteFooter";
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
    <div className="relative min-h-dvh overflow-x-clip">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[color:var(--bg)]" />
        <div className="absolute inset-0 bg-[radial-gradient(800px_500px_at_50%_0%,rgba(78,231,199,0.08),transparent_60%)]" />
      </div>

      <SiteHeader />

      <main className="mx-auto max-w-3xl px-5 pt-20 pb-20">
        {/* App icon */}
        <div className="flex justify-center">
          <img
            src="/app-icon.png"
            alt="EMWaver app icon"
            className="h-28 w-28 rounded-[1.75rem] border border-[color:var(--line)] shadow-[0_16px_48px_rgba(0,0,0,0.4)]"
          />
        </div>

        {/* Heading */}
        <div className="pt-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-4xl">
            Install EMWaver
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-7 text-[color:var(--ink-dim)]">
            Available on all major platforms. Download the app, plug in your board, and start
            exploring.
          </p>
        </div>

        {/* Store cards */}
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {STORES.map((store) => (
            <a
              key={store.platform}
              href={store.href}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-4 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 no-underline transition hover:bg-[color:var(--surface-2)]"
            >
              <img
                src={store.badge}
                alt={`${store.platform} badge`}
                className="h-10 w-10 shrink-0 object-contain"
              />
              <div>
                <div className="text-xs font-semibold text-[color:var(--ink-dim)]">
                  {store.platform}
                </div>
                <div className="pt-1 text-lg font-semibold text-[color:var(--ink)]">
                  {store.name}
                </div>
                <div className="pt-0.5 text-sm text-[color:var(--ink-dim)]">
                  {store.description}
                </div>
              </div>
            </a>
          ))}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
