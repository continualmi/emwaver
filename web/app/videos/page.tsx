import Link from "next/link";
import { SiteHeader } from "@/components/emwaver/SiteHeader";

const VIDEOS = [
  {
    title: "EMWaver Platform Capabilities",
    summary:
      "A walkthrough of the software platform, desktop MCP workflows, and real hardware control flows.",
    href: "https://youtu.be/Tyr9nzmqRUs",
    embedUrl: "https://www.youtube-nocookie.com/embed/Tyr9nzmqRUs?rel=0",
    eyebrow: "Platform walkthrough",
  },
  {
    title: "EMWaver Hardware and JLCPCB Ordering",
    summary:
      "Hardware overview plus the self-build path for getting a supported EMWaver setup in hand.",
    href: "https://youtu.be/K1l5yQR52s0",
    embedUrl: "https://www.youtube-nocookie.com/embed/K1l5yQR52s0?rel=0",
    eyebrow: "Hardware + build",
  },
  {
    title: "EMWaver Trailer",
    summary:
      "The fastest public introduction to EMWaver as a script-first electronics platform.",
    href: "https://www.youtube.com/watch?v=6acoNgBqpe0",
    embedUrl: "https://www.youtube-nocookie.com/embed/6acoNgBqpe0?rel=0",
    eyebrow: "Launch intro",
  },
] as const;

export default function VideosPage() {
  return (
    <div className="install-mode relative min-h-dvh overflow-x-clip">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(800px_500px_at_50%_0%,var(--aqua-tint-2),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(700px_480px_at_85%_18%,var(--sky-tint),transparent_62%)]" />
      </div>

      <SiteHeader />

      <main className="mx-auto max-w-6xl px-5 pb-20 pt-16">
        <section className="rounded-[2rem] border border-[color:var(--line)] bg-[color:var(--glass)] p-8 shadow-[0_24px_70px_var(--shadow)]">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-[color:var(--surface-2)] px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--aqua)]">
              Media
            </div>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">
EMWaver videos
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-[color:var(--ink-dim)]">
              Watch the launch trailer, platform walkthroughs, and hardware build videos for
              the local-first EMWaver electronics platform.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/build"
                className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-5 py-3 text-sm font-semibold text-[color:var(--paper)] hover:opacity-95"
              >
                Open Build
              </Link>
              <Link
                href="/docs"
                className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-5 py-3 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-3)]"
              >
                Read docs
              </Link>
            </div>
          </div>
        </section>

        <section className="mt-10 grid gap-8">
          {VIDEOS.map((video, index) => (
            <article
              key={`${video.title}-${index}`}
              className="overflow-hidden rounded-[2rem] border border-[color:var(--line)] bg-[color:var(--surface)] shadow-[0_20px_50px_var(--shadow)]"
            >
              <div className="border-b border-[color:var(--line)] px-6 py-5">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--aqua)]">
                  {video.eyebrow}
                </div>
                <h2 className="mt-2 text-2xl font-semibold text-[color:var(--ink)]">{video.title}</h2>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-[color:var(--ink-dim)]">
                  {video.summary}
                </p>
              </div>
              <div className="p-5 sm:p-6">
                <div className="overflow-hidden rounded-[1.5rem] border border-[color:var(--line)] bg-black/20">
                  <div className="aspect-video">
                    <iframe
                      src={video.embedUrl}
                      title={video.title}
                      className="h-full w-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allowFullScreen
                    />
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-[color:var(--ink-dim)]">
                    EMWaver media on the product site.
                  </div>
                  <a
                    href={video.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-3)]"
                  >
                    Open on YouTube
                  </a>
                </div>
              </div>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
