import Link from "next/link";

const DISCORD_INVITE_URL = "https://discord.gg/ZBNJGwBfPp";

export default function DocsCommunityPage() {
  return (
    <>
      <h1>Community &amp; Help</h1>
      <p>
        If you need help with EMWaver, want to report an issue, or want to share what you are
        building, the main community home is the Continual Society Discord.
      </p>

      <h2>Join the community</h2>
      <p>
        Discord is where support and discussion happen right now: setup help, script questions,
        hardware bring-up, bug reports, feature requests, and direct feedback around EMWaver and
        the wider Continual MI work.
      </p>
      <a
        href={DISCORD_INVITE_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-4 flex items-center gap-4 rounded-3xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 no-underline transition-colors hover:bg-[color:var(--surface-2)]"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#5865F2] text-white">
          <svg
            width="28"
            height="28"
            viewBox="0 0 127.14 96.36"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M107.7 8.07A105.15 105.15 0 0081.47 0a72.06 72.06 0 00-3.36 6.83 97.68 97.68 0 00-29.11 0A72.37 72.37 0 0045.64 0 105.89 105.89 0 0019.39 8.09C2.79 32.65-1.71 56.6.54 80.21h.02a105.73 105.73 0 0032.17 16.15 77.7 77.7 0 006.89-11.18 68.42 68.42 0 01-10.85-5.18c.91-.66 1.8-1.34 2.66-2.04a75.57 75.57 0 0064.32 0c.87.71 1.76 1.39 2.67 2.04a68.68 68.68 0 01-10.87 5.19 77 77 0 006.89 11.17 105.25 105.25 0 0032.19-16.14h.02c2.64-27.36-4.5-51.09-18.96-72.15zM42.45 65.69C36.18 65.69 31 60 31 53s5.05-12.74 11.45-12.74S54 46 53.91 53c0 7-5.06 12.69-11.46 12.69zm42.24 0c-6.27 0-11.45-5.69-11.45-12.69S78.29 40.26 84.69 40.26 96.15 46 96.15 53c0 7-5.05 12.69-11.46 12.69z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-dim)]">
            Community
          </div>
          <div className="mt-1 text-lg font-semibold text-[color:var(--ink)]">
            Join the Continual Society Discord
          </div>
          <div className="mt-1 text-sm text-[color:var(--ink-dim)]">
            Get setup help, ask script and hardware questions, report bugs, and stay close to new
            EMWaver updates.
          </div>
        </div>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-[color:var(--ink-dim)]"
          aria-hidden="true"
        >
          <path d="M7 17 17 7" />
          <path d="M7 7h10v10" />
        </svg>
      </a>

      <h2>What to ask there</h2>
      <ul>
        <li>Install, activation, and account issues.</li>
        <li>Questions about scripts, device APIs, or UI widgets.</li>
        <li>Help choosing a supported board or wiring peripherals.</li>
        <li>Bug reports, feature ideas, and workflow feedback.</li>
      </ul>

      <h2>Before you post</h2>
      <p>
        It helps to include your board, platform, app version, and the script or hardware module
        you are using. If your question is about writing a script, the{" "}
        <Link href="/docs/scripts">scripting guide</Link> and{" "}
        <Link href="/docs/scripts/device-api">device API</Link> pages are the best references to
        check first.
      </p>
    </>
  );
}
