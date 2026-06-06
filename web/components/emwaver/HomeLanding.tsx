"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  motion,
  useScroll,
  useTransform,
  useMotionValueEvent,
} from "motion/react";

import { SiteHeader } from "@/components/emwaver/SiteHeader";
import SmoothScroll from "@/components/emwaver/SmoothScroll";
import Reveal from "@/components/emwaver/Reveal";

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

const trailer = {
  title: "EMWaver Trailer",
  href: "https://www.youtube.com/watch?v=6acoNgBqpe0",
  embedUrl: "https://www.youtube-nocookie.com/embed/6acoNgBqpe0?rel=0",
};

/* ──────────────────────────────────────────────────────────────
   Scroll-gated showcase data
   ────────────────────────────────────────────────────────────── */

type Pillar = {
  id: string;
  index: string;
  eyebrow: string;
  title: string;
  headline: string;
  body: string;
  href: string;
  cta: string;
  image?: string;
  visual?: "agent";
  accent: string; // css color var
  glow: string;
};

const PILLARS: Pillar[] = [
  {
    id: "build",
    index: "01",
    eyebrow: "Build",
    title: "Plug in and start building.",
    headline: "Pick a board, run scripts in minutes.",
    body: "Grab a supported ESP32 or STM32 build, open the native app, and you are running local scripts on real hardware — no accounts, no cloud, no toolchain setup to fight first.",
    href: "/build",
    cta: "Open Build",
    image: "/landing1.jpeg",
    accent: "var(--aqua)",
    glow: "rgba(78,231,199,0.20)",
  },
  {
    id: "local",
    index: "02",
    eyebrow: "Local-first",
    title: "Your computer stays in charge.",
    headline: "No accounts. No cloud activation. No relay.",
    body: "EMWaver runs from native apps on your own machine. The host owns UI, storage, and orchestration while supported boards handle the timing-sensitive hardware edge — USB-first, with BLE and Wi-Fi where boards support them.",
    href: "/install",
    cta: "Install the app",
    image: "/landing3.png",
    accent: "var(--sky)",
    glow: "rgba(91,192,255,0.20)",
  },
  {
    id: "devices",
    index: "03",
    eyebrow: "Open hardware",
    title: "Boards designed for scripting.",
    headline: "ESP32, STM32, and EMWaver modules.",
    body: "EMWaver supports a growing catalog of open boards — from ESP32-family dev boards to purpose-built EMWaver modules — each with platform-managed firmware so the workflow stays script-first.",
    href: "/build",
    cta: "See the devices",
    image: "/EMWAVER.png",
    accent: "var(--aqua)",
    glow: "rgba(78,231,199,0.20)",
  },
  {
    id: "agent",
    index: "04",
    eyebrow: "Desktop MCP",
    title: "Agent tools without app chat.",
    headline: "Expose local tools only when you enable them.",
    body: "Desktop EMWaver apps can expose a local MCP bridge with named tools like spi_transfer, gpio_read, analog_read, run_script, and device_state. External agents use those tools to turn working flows into reusable local .js scripts with UI controls and live plots.",
    href: "/docs",
    cta: "Read the docs",
    visual: "agent",
    accent: "var(--copper)",
    glow: "rgba(240,166,106,0.18)",
  },
];

const comparisonRows = [
  ["Interface", "Full host screen", "128x64 monochrome", "External serial monitor or add-on display"],
  ["Storage", "Local host filesystem", "SD card", "Limited board flash unless you add storage"],
  ["AI workflow", "Optional desktop MCP tools", "None built in", "External tools only"],
  ["Development", "Instant local JavaScript scripts", "Firmware build/flash for deeper changes", "Sketch compile/upload loop"],
  ["Hardware model", "Multiple supported boards", "Single handheld device", "Many boards, fragmented workflows"],
  ["Core access", "Account-free local control", "Device-local", "Account-free local control"],
];

const gettingStarted = [
  {
    step: "1",
    title: "Pick a supported board",
    body: "Start with an ESP32-family board (ESP32, ESP32-S2, or ESP32-S3), or an EMWaver STM32 build from the catalog.",
    href: "/build",
    cta: "Open Build",
  },
  {
    step: "2",
    title: "Install the app",
    body: "Use the native app for your platform and let EMWaver manage the board setup where practical.",
    href: "/install",
    cta: "Install",
  },
  {
    step: "3",
    title: "Run scripts",
    body: "Explore GPIO, buses, sensors, IR, RFID, and module workflows with local JavaScript scripts.",
    href: "/scripts",
    cta: "Browse scripts",
  },
];

/* ──────────────────────────────────────────────────────────────
   Hero — parallax key art + staggered entrance
   ────────────────────────────────────────────────────────────── */

function Hero() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const contentY = useTransform(scrollYProgress, [0, 1], ["0%", "30%"]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);

  return (
    <section
      ref={ref}
      className="relative isolate flex min-h-[100svh] flex-col justify-center overflow-hidden px-5 pb-16 pt-28"
    >
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(900px 540px at 22% 18%, var(--sky-tint-2), transparent 60%), radial-gradient(820px 520px at 82% 12%, var(--aqua-tint-2), transparent 62%)",
        }}
      />

      <motion.div
        style={{ y: contentY, opacity: contentOpacity }}
        className="relative z-10 mx-auto w-full max-w-6xl"
      >
        <h1 className="max-w-4xl text-5xl font-semibold leading-[1.0] tracking-tight text-[color:var(--ink)] md:text-7xl">
          <span className="block overflow-hidden">
            <motion.span
              className="block"
              initial={{ y: "110%" }}
              animate={{ y: "0%" }}
              transition={{ duration: 0.9, delay: 0.12, ease: EASE_OUT }}
            >
              Electronics development,
            </motion.span>
          </span>
          <span className="block overflow-hidden">
            <motion.span
              className="block text-[color:var(--aqua)]"
              initial={{ y: "110%" }}
              animate={{ y: "0%" }}
              transition={{ duration: 0.9, delay: 0.22, ease: EASE_OUT }}
            >
              reimagined.
            </motion.span>
          </span>
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.42, ease: EASE_OUT }}
          className="mt-6 max-w-2xl text-[17px] leading-8 text-[color:var(--ink-dim)]"
        >
          EMWaver turns supported MCU boards into a scriptable hardware lab. Plug
          in, run local JavaScript scripts, and explore real electronics without
          accounts, cloud activation, or firmware toolchains.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.54, ease: EASE_OUT }}
          className="mt-8 flex flex-wrap gap-3"
        >
          <Link
            href="/build"
            className="inline-flex items-center justify-center rounded-xl bg-[color:var(--aqua)] px-6 py-3 text-sm font-semibold text-slate-950 transition hover:opacity-90"
          >
            Build EMWaver
          </Link>
          <a
            href="#trailer"
            className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-6 py-3 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface-2)]"
          >
            Watch trailer
          </a>
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.1, duration: 1 }}
        className="absolute bottom-5 left-1/2 z-10 -translate-x-1/2"
      >
        <div className="flex h-9 w-5 items-start justify-center rounded-full border border-[color:var(--line-strong,rgba(233,238,252,0.24))] p-1">
          <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[color:var(--aqua)]" />
        </div>
      </motion.div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────
   MCP tool-loop console — EMWaver's signature scroll-gated visual
   ────────────────────────────────────────────────────────────── */

const AGENT_LINES: {
  kind: "user" | "tool" | "result" | "agent";
  fn?: string;
  text: string;
}[] = [
  { kind: "user", text: "Find this SPI sensor and read its ID register." },
  { kind: "tool", fn: "gpio_write", text: "CS, LOW" },
  { kind: "tool", fn: "spi_transfer", text: "0x9F" },
  { kind: "result", text: "0xEF 0x40 0x18  · chip identified" },
  { kind: "tool", fn: "analog_read", text: "A0" },
  { kind: "result", text: "2.48 V" },
  { kind: "agent", text: "Writing dashboard.js — buttons, live plot, log viewer." },
];

function AgentConsole() {
  return (
    <div className="absolute inset-0 bg-[#04060d]">
      <div className="flex items-center gap-2 border-b border-[color:var(--line)] px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--copper)]/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--ink-dim)]/40" />
        <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--ink-dim)]/40" />
        <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--ink-dim)]">
          desktop mcp · tool loop
        </span>
      </div>

      <div className="space-y-2 p-4 font-mono text-[12px] leading-5 sm:text-[13px]">
        {AGENT_LINES.map((line, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.12 + i * 0.12, ease: EASE_OUT }}
            className="flex gap-2"
          >
            {line.kind === "user" && (
              <>
                <span className="text-[color:var(--aqua)]">you ›</span>
                <span className="text-[color:var(--ink)]">{line.text}</span>
              </>
            )}
            {line.kind === "tool" && (
              <>
                <span className="text-[color:var(--ink-dim)]">call</span>
                <span className="text-[color:var(--copper)]">{line.fn}</span>
                <span className="text-[color:var(--ink-dim)]">({line.text})</span>
              </>
            )}
            {line.kind === "result" && (
              <>
                <span className="text-[color:var(--ink-dim)]">←</span>
                <span className="text-[color:var(--sky)]">{line.text}</span>
              </>
            )}
            {line.kind === "agent" && (
              <>
                <span className="text-[color:var(--copper)]">external agent ›</span>
                <span className="text-[color:var(--ink)]">{line.text}</span>
              </>
            )}
          </motion.div>
        ))}
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[color:var(--copper)]">external agent ›</span>
          <motion.span
            animate={{ opacity: [1, 0.15, 1] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
            className="inline-block h-3.5 w-2 bg-[color:var(--ink)]"
          />
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Scroll-gated showcase
   ────────────────────────────────────────────────────────────── */

function PillarContent({ pillar }: { pillar: Pillar }) {
  return (
    <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 sm:px-8 lg:grid-cols-2 lg:gap-14">
      {/* copy */}
      <div className="order-2 lg:order-1">
        <div
          className="text-[11px] font-semibold uppercase tracking-[0.28em]"
          style={{ color: pillar.accent }}
        >
          {pillar.index} · {pillar.eyebrow}
        </div>
        <h3 className="mt-4 text-3xl font-semibold tracking-tight text-[color:var(--ink)] sm:text-4xl">
          {pillar.title}
        </h3>
        <div
          className="mt-3 text-lg font-semibold sm:text-xl"
          style={{ color: pillar.accent }}
        >
          {pillar.headline}
        </div>
        <p className="mt-5 max-w-xl text-[15px] leading-7 text-[color:var(--ink-dim)] sm:text-base">
          {pillar.body}
        </p>
        <Link
          href={pillar.href}
          className="group mt-7 inline-flex items-center gap-2 rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-6 py-3 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface-2)]"
        >
          {pillar.cta}
          <span className="transition-transform duration-300 group-hover:translate-x-1">
            →
          </span>
        </Link>
      </div>

      {/* visual */}
      <div className="order-1 lg:order-2">
        <div className="relative mx-auto aspect-[16/11] w-full max-h-[46vh] max-w-[620px] overflow-hidden rounded-2xl border border-[color:var(--line)] bg-black shadow-[0_40px_120px_var(--shadow-heavy)] lg:max-h-[60vh] lg:max-w-none">
          {pillar.visual === "agent" ? (
            <AgentConsole />
          ) : (
            <motion.div
              initial={{ scale: 1.08 }}
              animate={{ scale: 1 }}
              transition={{ duration: 1.1, ease: EASE_OUT }}
              className="absolute inset-0 will-change-transform"
            >
              <Image
                src={pillar.image ?? ""}
                alt={pillar.title}
                fill
                unoptimized
                sizes="(min-width: 1024px) 45vw, 100vw"
                className="object-cover"
              />
            </motion.div>
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
          <div
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              background: `radial-gradient(120% 90% at 50% 120%, ${pillar.glow}, transparent 60%)`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function Showcase() {
  const ref = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  useMotionValueEvent(scrollYProgress, "change", (v) => {
    const i = Math.min(PILLARS.length - 1, Math.max(0, Math.floor(v * PILLARS.length)));
    setActive(i);
  });

  const pillar = PILLARS[active];

  return (
    <section
      ref={ref}
      className="relative"
      style={{ height: `${PILLARS.length * 100}vh` }}
    >
      <div className="sticky top-0 flex h-screen items-center overflow-hidden bg-[#05070e]">
        <div
          className="pointer-events-none absolute inset-0 transition-[background] duration-700"
          style={{
            background: `radial-gradient(900px 600px at 78% 50%, ${pillar.glow}, transparent 65%)`,
          }}
        />

        <div className="absolute left-0 right-0 top-0 z-20 px-5 pt-24 sm:px-8">
          <div className="mx-auto max-w-6xl">
            <div
              className="text-[11px] font-semibold uppercase tracking-[0.28em]"
              style={{ color: "var(--aqua)" }}
            >
              Why EMWaver
            </div>
            <div className="mt-2 text-sm text-[color:var(--ink-dim)]">
              One platform, three ideas.
            </div>
          </div>
        </div>

        {PILLARS.map((p, i) => (
          <div
            key={p.id}
            className={`absolute inset-0 flex items-center py-32 transition-opacity duration-500 ease-out sm:py-28 ${
              i === active ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            <PillarContent pillar={p} />
          </div>
        ))}

        <div className="absolute bottom-9 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3">
          {PILLARS.map((p, i) => (
            <div key={p.id} className="flex items-center gap-3">
              <span
                className="font-mono text-xs transition-colors duration-300"
                style={{ color: i === active ? "var(--ink)" : "var(--ink-dim)" }}
              >
                {p.index}
              </span>
              <div className="h-px w-10 overflow-hidden rounded-full bg-[color:var(--line)]">
                <div
                  className={`h-full rounded-full bg-[color:var(--aqua)] transition-[width] duration-500 ${
                    i === active ? "w-full" : i < active ? "w-full opacity-40" : "w-0"
                  }`}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────
   Trailer
   ────────────────────────────────────────────────────────────── */

function Trailer() {
  return (
    <section id="trailer" className="mx-auto max-w-6xl px-5 py-20">
      <Reveal>
        <div className="grid gap-8 md:grid-cols-[0.85fr_1.15fr] md:items-center">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--aqua)]">
              Trailer
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-4xl">
              See EMWaver in motion.
            </h2>
            <p className="mt-4 text-[15px] leading-7 text-[color:var(--ink-dim)]">
              The launch trailer is the fastest way to understand EMWaver: a
              phone-first, script-first electronics platform that keeps local
              hardware control open and immediate.
            </p>
            <a
              href={trailer.href}
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-5 py-3 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface-3)]"
            >
              Open on YouTube
            </a>
          </div>
          <div className="overflow-hidden rounded-[1.5rem] border border-[color:var(--line)] bg-black/30 shadow-xl shadow-black/20">
            <div className="aspect-video">
              <iframe
                src={trailer.embedUrl}
                title={trailer.title}
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────
   Comparison
   ────────────────────────────────────────────────────────────── */

function Comparison() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20">
      <Reveal className="max-w-3xl">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--copper)]">
          Different from handhelds and dev boards
        </div>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-4xl">
          Why EMWaver over Flipper Zero or Arduino?
        </h2>
        <p className="mt-4 text-[15px] leading-7 text-[color:var(--ink-dim)]">
          EMWaver is not a Flipper clone and not a conventional MCU board
          workflow. It uses the host for the things hosts are good at, then keeps
          hardware interaction scriptable and local.
        </p>
      </Reveal>
      <Reveal delay={0.08} className="mt-8 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface-3)] p-3 md:p-4">
        <div className="grid gap-3 md:hidden">
          {comparisonRows.map(([feature, emwaver, flipper, arduino]) => (
            <article key={feature} className="rounded-xl border border-[color:var(--table-border)] bg-[color:var(--surface-2)] p-4">
              <h3 className="font-semibold text-[color:var(--ink)]">{feature}</h3>
              <dl className="mt-3 grid gap-2 text-sm leading-6">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--aqua)]">EMWaver</dt>
                  <dd className="text-[color:var(--aqua)]">{emwaver}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-dim)]">Flipper Zero</dt>
                  <dd className="text-[color:var(--ink-dim)]">{flipper}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-dim)]">Arduino</dt>
                  <dd className="text-[color:var(--ink-dim)]">{arduino}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
        <table className="hidden w-full table-fixed text-left text-sm md:table">
          <colgroup>
            <col className="w-[18%]" />
            <col className="w-[30%]" />
            <col className="w-[26%]" />
            <col className="w-[26%]" />
          </colgroup>
          <thead className="bg-[color:var(--table-header-bg)]">
            <tr>
              <th className="rounded-tl-xl px-4 py-3 font-semibold text-[color:var(--ink)]" />
              <th className="px-4 py-3 font-semibold text-[color:var(--aqua)]">EMWaver</th>
              <th className="px-4 py-3 font-semibold text-[color:var(--ink-dim)]">Flipper Zero</th>
              <th className="rounded-tr-xl px-4 py-3 font-semibold text-[color:var(--ink-dim)]">Arduino</th>
            </tr>
          </thead>
          <tbody className="text-[color:var(--ink-dim)]">
            {comparisonRows.map(([feature, emwaver, flipper, arduino]) => (
              <tr key={feature} className="border-t border-[color:var(--table-border)] align-top">
                <td className="px-4 py-4 font-medium text-[color:var(--ink)]">{feature}</td>
                <td className="px-4 py-4 text-[color:var(--aqua)]">{emwaver}</td>
                <td className="px-4 py-4">{flipper}</td>
                <td className="px-4 py-4">{arduino}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Reveal>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────
   Get started + closing CTA
   ────────────────────────────────────────────────────────────── */

function GetStarted() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20">
      <Reveal>
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--aqua)]">
          Get started
        </div>
        <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-4xl">
          Bring up a local electronics lab in three steps.
        </h2>
      </Reveal>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {gettingStarted.map((item, i) => (
          <Reveal key={item.step} delay={i * 0.08}>
            <Link
              href={item.href}
              className="block h-full rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface-3)] p-6 transition hover:bg-[color:var(--surface-2)]"
            >
              <div className="text-xs font-semibold text-[color:var(--aqua)]">
                Step {item.step}
              </div>
              <div className="pt-3 text-lg font-semibold text-[color:var(--ink)]">
                {item.title}
              </div>
              <p className="pt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
                {item.body}
              </p>
              <div className="pt-5 text-sm font-semibold text-[color:var(--sky)]">
                {item.cta} →
              </div>
            </Link>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function ClosingCTA() {
  return (
    <section className="relative overflow-hidden px-5 py-24">
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          background:
            "radial-gradient(760px 460px at 50% 0%, var(--aqua-tint-2), transparent 62%), radial-gradient(700px 460px at 50% 120%, var(--sky-tint-2), transparent 60%)",
        }}
      />
      <Reveal className="relative mx-auto max-w-3xl text-center">
        <h2 className="text-4xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">
          Build your local hardware lab.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-[15px] leading-7 text-[color:var(--ink-dim)] sm:text-base">
          Pick a board, install the app, and start running real electronics from
          local scripts — open hardware, no accounts, no cloud.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/build"
            className="inline-flex items-center justify-center rounded-xl bg-[color:var(--aqua)] px-7 py-3.5 text-sm font-semibold text-slate-950 transition hover:opacity-90"
          >
            Build EMWaver
          </Link>
          <Link
            href="/install"
            className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-7 py-3.5 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface-2)]"
          >
            Install the app
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────
   Page
   ────────────────────────────────────────────────────────────── */

export default function HomeLanding() {
  return (
    <div className="min-h-dvh overflow-x-clip">
      <SmoothScroll />
      <SiteHeader />
      <main>
        <Hero />
        <Showcase />
        <Trailer />
        <Comparison />
        <GetStarted />
        <ClosingCTA />
      </main>
    </div>
  );
}
