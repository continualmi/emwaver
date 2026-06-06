import Link from "next/link";
import { SiteHeader } from "@/components/emwaver/SiteHeader";

export default function SupportPage() {
  return (
    <div className="min-h-dvh overflow-hidden">
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-5 py-14">
        <section className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-1.5 text-xs font-semibold text-[color:var(--ink-dim)]">
            <span className="h-2 w-2 rounded-full bg-[color:var(--sky)]" />
            Support
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">
            EMWaver Support
          </h1>
          <p className="mt-5 max-w-2xl text-[17px] leading-8 text-[color:var(--ink-dim)]">
            Help with supported boards, installation, scripts, firmware, and more.
          </p>
        </section>

        {/* ── Quick Links ── */}
        <section className="mt-12 grid gap-4 md:grid-cols-3">
          {[
            {
              title: "Documentation",
              body: "Install guides, hardware specs, scripting API, and board references.",
              href: "/docs",
              cta: "Browse docs",
            },
            {
              title: "Community",
              body: "Join the Continual MI Discord for help, discussion, and updates.",
              href: "https://discord.gg/eHMfkp5Vjd",
              cta: "Join Discord",
              external: true,
            },
            {
              title: "Build & Hardware",
              body: "Find supported boards, build instructions, and hardware catalog.",
              href: "/build",
              cta: "Open Build",
            },
          ].map((card) => (
            <Link
              key={card.href}
              href={card.href}
              target={card.external ? "_blank" : undefined}
              rel={card.external ? "noreferrer" : undefined}
              className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface-3)] p-6 transition hover:bg-[color:var(--surface-2)]"
            >
              <h2 className="text-lg font-semibold text-[color:var(--ink)]">
                {card.title}
              </h2>
              <p className="pt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
                {card.body}
              </p>
              <div className="pt-5 text-sm font-semibold text-[color:var(--sky)]">
                {card.cta}
              </div>
            </Link>
          ))}
        </section>

        {/* ── FAQ ── */}
        <section className="mt-16 max-w-3xl">
          <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--ink)]">
            Frequently asked questions
          </h2>

          <div className="mt-8 space-y-6">
            {[
              {
                q: "Do I need to create an account?",
                a: "No. EMWaver is local-first and open-source. Core hardware control — plugging in a board, running scripts, and exploring signals — does not require an account, cloud activation, or a subscription. External Agent help is separate from local hardware access.",
              },
              {
                q: "What boards are supported?",
                a: (
                  <>
                    Currently supported targets include ESP32-family dev boards
                    (ESP32, ESP32-S2, and ESP32-S3) and the EMWaver Shield carrier. The EMWaver lineup of custom boards is listed
                    in the{" "}
                    <Link href="/docs/hardware" className="text-[color:var(--sky)] underline decoration-[color:var(--link-underline)] hover:decoration-[color:var(--link-underline-hover)]">
                      hardware docs
                    </Link>{" "}
                    and on the{" "}
                    <Link href="/build" className="text-[color:var(--sky)] underline decoration-[color:var(--link-underline)] hover:decoration-[color:var(--link-underline-hover)]">
                      Build page
                    </Link>
                    . More targets are added as firmware ports are completed.
                  </>
                ),
              },
              {
                q: "Do I need to install any drivers?",
                a: "No. Supported boards enumerate as standard USB MIDI devices over USB-C. The native apps detect them automatically — no driver installation, DFU utility, or MCU toolchain required.",
              },
              {
                q: "How do firmware updates work?",
                a: "Firmware is managed by the platform. The native apps bundle per-board firmware payloads and handle the update flow through the app interface. You should never need to build or flash firmware manually.",
              },
              {
                q: "Can I write my own firmware?",
                a: "The firmware source is open-source and the repos are available, but the platform is designed so end users do not need to go through a compile/flash loop. If you want to hack on firmware, that path is available — just not required for normal use.",
              },
              {
                q: "What does the Agent do?",
                a: (
                  <>
                    The Agent assists with writing, debugging, explaining, and improving local
                    JavaScript scripts. On desktop, external agents can use the local MCP bridge
                    you enable in the app to inspect device state, run scripts, and call hardware
                    tools such as SPI, GPIO, and analog reads. See{" "}
                    <Link href="/docs/scripts" className="text-[color:var(--sky)] underline decoration-[color:var(--link-underline)] hover:decoration-[color:var(--link-underline-hover)]">
                      scripting docs
                    </Link>{" "}
                    for details.
                  </>
                ),
              },
              {
                q: "Where can I get help?",
                a: (
                  <>
                    The fastest way is the{" "}
                    <a
                      href="https://discord.gg/eHMfkp5Vjd"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[color:var(--sky)] underline decoration-[color:var(--link-underline)] hover:decoration-[color:var(--link-underline-hover)]"
                    >
                      Continual MI Discord
                    </a>
                    . For documentation-specific questions, start with the{" "}
                    <Link href="/docs" className="text-[color:var(--sky)] underline decoration-[color:var(--link-underline)] hover:decoration-[color:var(--link-underline-hover)]">
                      documentation
                    </Link>
                    . For bug reports, open an issue on the{" "}
                    <a
                      href="https://github.com/continualmi/emwaver"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[color:var(--sky)] underline decoration-[color:var(--link-underline)] hover:decoration-[color:var(--link-underline-hover)]"
                    >
                      GitHub repository
                    </a>
                    .
                  </>
                ),
              },
            ].map((faq) => (
              <div
                key={faq.q}
                className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface-3)] p-6"
              >
                <h3 className="text-base font-semibold text-[color:var(--ink)]">
                  {faq.q}
                </h3>
                <div className="mt-2 text-sm leading-7 text-[color:var(--ink-dim)]">
                  {faq.a}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Contact ── */}
        <section className="mt-16 max-w-3xl">
          <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--ink)]">
            Contact
          </h2>
          <p className="mt-4 text-[15px] leading-7 text-[color:var(--ink-dim)]">
            EMWaver is built by{" "}
            <a
              href="https://continualmi.com"
              target="_blank"
              rel="noreferrer"
              className="text-[color:var(--sky)] underline decoration-[color:var(--link-underline)] hover:decoration-[color:var(--link-underline-hover)]"
            >
              Continual MI
            </a>
            . For product questions, partnership inquiries, or press, join the Discord
            or reach out through the community.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="https://discord.gg/eHMfkp5Vjd"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-6 py-3 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface-2)]"
            >
              Discord Community
            </a>
            <a
              href="https://github.com/continualmi/emwaver"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-6 py-3 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface-2)]"
            >
              GitHub
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
