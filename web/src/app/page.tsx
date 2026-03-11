import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

export default function HomePage() {
  const scriptPlatforms = [
    {
      name: "iOS",
      detail: "Native phone UI",
      src: "/script_ios.PNG",
      alt: "Script UI rendered on iOS",
      frameClassName: "aspect-[9/16]",
      imageClassName: "h-full w-full object-contain p-3",
      spanClassName: "",
    },
    {
      name: "Android",
      detail: "Same controls, same flow",
      src: "/script_android.jpeg",
      alt: "Script UI rendered on Android",
      frameClassName: "aspect-[9/16]",
      imageClassName: "h-full w-full object-contain p-3",
      spanClassName: "",
    },
    {
      name: "macOS",
      detail: "Native desktop shell",
      src: "/script_macos.png",
      alt: "Script UI rendered on macOS",
      frameClassName: "aspect-[16/10]",
      imageClassName: "h-full w-full object-contain p-4",
      spanClassName: "sm:col-span-2",
    },
    {
      name: "Windows",
      detail: "Native desktop shell",
      src: "/script_windows.jpeg",
      alt: "Script UI rendered on Windows",
      frameClassName: "aspect-[16/10]",
      imageClassName: "h-full w-full object-contain p-4",
      spanClassName: "sm:col-span-2",
    },
  ];

  return (
    <div className="relative min-h-dvh overflow-hidden">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <img src="/2015_upscale.jpg" alt="" className="h-full w-full object-cover opacity-[0.72]" />
        <div className="absolute inset-0 bg-[radial-gradient(900px_600px_at_15%_0%,rgba(255,255,255,0.10),transparent_60%),radial-gradient(900px_600px_at_85%_10%,rgba(78,231,199,0.10),transparent_62%)]" />
      </div>

      <SiteHeader />

      <main>
        {/* ─── HERO ─── */}
        <section className="mx-auto max-w-6xl px-5 pt-16 pb-12">
          <div className="text-center">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-1.5 text-xs text-[color:var(--ink-dim)]">
              <span className="inline-block h-2 w-2 rounded-full bg-[color:var(--aqua)]" />
              The future of electronics development
            </div>

            <h1 className="mx-auto mt-6 max-w-4xl text-4xl leading-[1.05] font-semibold tracking-tight text-[color:var(--ink)] md:text-6xl lg:text-7xl">
              Electronics development,{" "}
              <span className="bg-gradient-to-r from-[color:var(--aqua)] to-[color:var(--sky)] bg-clip-text text-transparent">
                reimagined.
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-[16px] leading-8 text-[color:var(--ink-dim)]">
              EMWaver is a tiny USB device that turns any phone, laptop, or Raspberry Pi into a
              full-power electronics lab. No firmware flashing, no toolchains, no limitations.
              Just plug in and go.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/build"
                className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-6 py-3.5 text-sm font-semibold text-[color:var(--paper)] shadow-[0_18px_40px_var(--shadow)] hover:opacity-95"
              >
                Build EMWaver
              </Link>
              <Link
                href="/scripts"
                className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-6 py-3.5 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                Browse scripts
              </Link>
            </div>
          </div>

          {/* Hero image: device + phone */}
          <div className="mx-auto mt-12 max-w-4xl">
            <div className="relative overflow-hidden rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.06)] backdrop-blur-md shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
              <div className="absolute inset-0 bg-[radial-gradient(600px_300px_at_30%_10%,rgba(78,231,199,0.18),transparent_55%),radial-gradient(600px_400px_at_90%_40%,rgba(91,192,255,0.14),transparent_58%)]" />
              <div className="relative p-6">
                {/* TODO: replace with a real hero product shot — device plugged into phone, rich UI on screen */}
                <img
                  src="/banner.jpeg"
                  alt="EMWaver platform banner showing Android, iOS, Linux, Mac, and Windows"
                  className="h-auto w-full rounded-2xl border border-[color:var(--line)] object-cover"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ─── PLATFORM PILLARS (3 cards) ─── */}
        <section className="mx-auto max-w-6xl px-5 pb-14">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.06)] p-6 backdrop-blur-md">
              <div className="text-xs font-semibold text-[color:var(--aqua)]">Host-powered</div>
              <div className="pt-3 text-lg font-semibold text-[color:var(--ink)]">Your phone is the computer</div>
              <div className="pt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
                EMWaver extracts power, compute, UI, storage, and connectivity from the host it&apos;s plugged into. No on-device screen or buttons needed — your phone or laptop <em>is</em> the interface.
              </div>
            </div>
            <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.06)] p-6 backdrop-blur-md">
              <div className="text-xs font-semibold text-[color:var(--sky)]">AI-first</div>
              <div className="pt-3 text-lg font-semibold text-[color:var(--ink)]">Agents that build and test</div>
              <div className="pt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
                AI agents write scripts, generate UI, and interact with the interfaces they create — testing autonomously. Full chip exploits in minutes, not days.
              </div>
            </div>
            <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.06)] p-6 backdrop-blur-md">
              <div className="text-xs font-semibold text-[color:var(--copper)]">Plug and play</div>
              <div className="pt-3 text-lg font-semibold text-[color:var(--ink)]">Zero prerequisites</div>
              <div className="pt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
                No toolchains, no firmware flashing, no IDE. Install the app, plug in the device. Start capturing and cloning IR signals in seconds.
              </div>
            </div>
          </div>
        </section>

        {/* ─── MANAGED DEVICE PLATFORM ─── */}
        <section className="mx-auto max-w-6xl px-5 pb-14">
          <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-6 md:p-10 backdrop-blur-md">
            <div className="grid gap-10 md:grid-cols-2 md:items-center">
              <div className="space-y-5">
                <div className="text-xs font-semibold tracking-wide text-[color:var(--aqua)]">
                  Why managed device flows change everything
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--ink)] md:text-3xl">
                  Stop being limited by your MCU.
                </h2>
                <p className="text-[15px] leading-7 text-[color:var(--ink-dim)]">
                  Traditional dev boards force one rigid execution model. EMWaver splits the problem
                  properly: host-backed boards lean on the app/desktop when that is best, while
                  autonomous targets can stay online directly when remote control matters more.
                </p>
                <div className="space-y-3 text-sm text-[color:var(--ink-dim)]">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-[rgba(78,231,199,0.15)] text-center text-xs leading-5 text-[color:var(--aqua)]">P</span>
                    <span><strong className="text-[color:var(--ink)]">Power + compute</strong> from the host — not battery-constrained</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-[rgba(78,231,199,0.15)] text-center text-xs leading-5 text-[color:var(--aqua)]">U</span>
                    <span><strong className="text-[color:var(--ink)]">Full-screen UI</strong> rendered natively on the host — not a 128x64 display</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-[rgba(78,231,199,0.15)] text-center text-xs leading-5 text-[color:var(--aqua)]">S</span>
                    <span><strong className="text-[color:var(--ink)]">Unlimited storage</strong> on the host for signals, captures, and artifacts</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-[rgba(78,231,199,0.15)] text-center text-xs leading-5 text-[color:var(--aqua)]">C</span>
                    <span><strong className="text-[color:var(--ink)]">Cloud-connected</strong> — control your EMWaver remotely from anywhere on Earth</span>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {/* TODO: replace with a real photo showing EMWaver plugged into a laptop with modules attached */}
                <div className="overflow-hidden rounded-2xl border border-[color:var(--line)]">
                  <img
                    src="/landing3.png"
                    alt="EMWaver connected to laptop with modules"
                    className="h-auto w-full object-cover"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="overflow-hidden rounded-2xl border border-[color:var(--line)]">
                    <img
                      src="/landing2.png"
                      alt="EMWaver device close-up"
                      className="h-36 w-full object-cover"
                    />
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-[color:var(--line)]">
                    <img
                      src="/landing1.jpeg"
                      alt="EMWaver plugged into a smartphone"
                      className="h-36 w-full object-cover"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── EMWAVER SCRIPTS ─── */}
        <section className="mx-auto max-w-6xl px-5 pb-14">
          <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-6 md:p-10 backdrop-blur-md">
            <div className="grid gap-10 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
              <div className="space-y-5">
                <div className="text-xs font-semibold tracking-wide text-[color:var(--copper)]">
                  EMWaver Scripts
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--ink)] md:text-3xl">
                  Zero compile. Zero flash.{" "}
                  <span className="text-[color:var(--copper)]">Instant results.</span>
                </h2>
                <p className="text-[15px] leading-7 text-[color:var(--ink-dim)]">
                  EMWaver scripts are designed with one question: how fast can you fully exploit
                  all functionality of any chip/module/sensor connected to the device?
                </p>
                <p className="text-[15px] leading-7 text-[color:var(--ink-dim)]">
                  The answer: lightning fast. Scripts run instantly from the host.
                  Change a line, see the result immediately. No build step, no flash cycle,
                  no waiting. Hardware + UI in one file.
                </p>
                <div className="grid gap-3 text-sm text-[color:var(--ink-dim)] sm:grid-cols-2">
                  <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
                    <div className="text-xs font-semibold tracking-wide text-[color:var(--copper)]">
                      One declarative UI
                    </div>
                    <div className="pt-2 leading-6">
                      <span className="rounded-md border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] px-2 py-0.5 font-mono text-[12px] text-[color:var(--ink)]">
                        sampler.emw
                      </span>{" "}
                      defines the controls, layout, state, and hardware actions once. EMWaver
                      renders the same interface model across phone and desktop apps.
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
                    <div className="text-xs font-semibold tracking-wide text-[color:var(--copper)]">
                      Native feel, same logic
                    </div>
                    <div className="pt-2 leading-6">
                      Buttons, sliders, live values, and status views stay consistent while each
                      host app presents them in a platform-native shell.
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.6)] p-5 backdrop-blur-md">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">
                        One script, every platform
                      </div>
                      <div className="pt-2">
                        <span className="inline-flex items-center rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 font-mono text-sm font-semibold text-[color:var(--ink)] shadow-[0_12px_30px_rgba(0,0,0,0.2)]">
                          sampler.emw
                        </span>
                      </div>
                    </div>
                    <div className="rounded-full border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] px-3 py-1 text-[11px] font-semibold tracking-[0.18em] text-[color:var(--ink-dim)] uppercase">
                      Shared runtime UI
                    </div>
                  </div>
                  <p className="pt-4 text-sm leading-7 text-[color:var(--ink-dim)]">
                    A single EMWaver script file can ship the hardware logic and the rendered UI
                    together. The screenshots here are the same{" "}
                    <span className="font-mono text-[color:var(--ink)]">sampler.emw</span>{" "}
                    experience shown on each host app, not separate per-platform implementations.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-[color:var(--ink-dim)]">
                    <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1">
                      Android
                    </div>
                    <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1">
                      iOS
                    </div>
                    <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1">
                      macOS
                    </div>
                    <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1">
                      Windows
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {scriptPlatforms.map((platform) => (
                  <div
                    key={platform.name}
                    className={`${platform.spanClassName} overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.6)] shadow-[0_24px_60px_rgba(0,0,0,0.28)]`}
                  >
                    <div className="flex items-center justify-between border-b border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] px-4 py-3">
                      <div>
                        <div className="text-sm font-semibold text-[color:var(--ink)]">{platform.name}</div>
                        <div className="text-[11px] tracking-wide text-[color:var(--ink-dim)] uppercase">
                          {platform.detail}
                        </div>
                      </div>
                      <div className="rounded-full border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-[10px] font-semibold tracking-[0.18em] text-[color:var(--ink-dim)] uppercase">
                        Script UI
                      </div>
                    </div>
                    <div className="p-4">
                      <div
                        className={`${platform.frameClassName} overflow-hidden rounded-xl border border-[color:var(--line)] bg-[radial-gradient(circle_at_top,rgba(78,231,199,0.08),rgba(3,8,18,0.96)_72%)]`}
                      >
                        <img
                          src={platform.src}
                          alt={platform.alt}
                          className={platform.imageClassName}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-2 text-xs text-[color:var(--ink-dim)]">
              <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1">
                Shared hardware logic
              </div>
              <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1">
                Consistent layout model
              </div>
              <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1">
                Native app surfaces
              </div>
              <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1">
                No per-platform rewrite
              </div>
            </div>
          </div>
        </section>

        {/* ─── BEGINNER-FRIENDLY / HACKING MULTITOOL ─── */}
        <section className="mx-auto max-w-6xl px-5 pb-14">
          <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-6 md:p-10 backdrop-blur-md">
            <div className="space-y-5 text-center">
              <div className="text-xs font-semibold tracking-wide text-[color:var(--aqua)]">
                The best hacking multitool on the planet
              </div>
              <h2 className="mx-auto max-w-3xl text-2xl font-semibold tracking-tight text-[color:var(--ink)] md:text-3xl">
                Plug into your phone. Start hacking.{" "}
                <span className="text-[color:var(--aqua)]">No prerequisites.</span>
              </h2>
              <p className="mx-auto max-w-2xl text-[15px] leading-7 text-[color:var(--ink-dim)]">
                EMWaver comes with built-in infrared receiver and transmitter. Plug it into your
                smartphone, open the app, and immediately start capturing, analyzing, cloning, and
                retransmitting IR signals. No cables, no setup, no prior knowledge required.
              </p>
            </div>

            <div className="mx-auto mt-8 max-w-2xl overflow-hidden rounded-2xl border border-[color:var(--line)]">
              <img
                src="/multitool.png"
                alt="EMWaver with CC1101 and RC522 modules attached"
                className="block h-auto w-full"
              />
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
                <div className="text-2xl">📡</div>
                <div className="pt-3 text-sm font-semibold text-[color:var(--ink)]">IR built-in</div>
                <div className="pt-2 text-xs leading-5 text-[color:var(--ink-dim)]">
                  Capture and clone TV remotes, AC controllers, LED strips — anything infrared. Out of the box.
                </div>
              </div>
              <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
                <div className="text-2xl">🧩</div>
                <div className="pt-3 text-sm font-semibold text-[color:var(--ink)]">Easy add-on modules</div>
                <div className="pt-2 text-xs leading-5 text-[color:var(--ink-dim)]">
                  Add capabilities with external modules like CC1101 radios, RC522 RFID, sensors, displays, and more.
                </div>
              </div>
              <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
                <div className="text-2xl">🚌</div>
                <div className="pt-3 text-sm font-semibold text-[color:var(--ink)]">Native bus access</div>
                <div className="pt-2 text-xs leading-5 text-[color:var(--ink-dim)]">
                  SPI, I2C, UART, ADC, PWM, and GPIO are exposed directly so scripts can talk to real hardware without firmware rebuilds.
                </div>
              </div>
              <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
                <div className="text-2xl">⚡</div>
                <div className="pt-3 text-sm font-semibold text-[color:var(--ink)]">Host-powered workflow</div>
                <div className="pt-2 text-xs leading-5 text-[color:var(--ink-dim)]">
                  Plug into your phone or computer and use the host for UI, compute, storage, and iteration speed.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── AI-FIRST ─── */}
        <section className="mx-auto max-w-6xl px-5 pb-14">
          <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-6 md:p-10 backdrop-blur-md">
            <div className="grid gap-10 md:grid-cols-[1.05fr_0.95fr] md:items-start">
              <div className="space-y-5">
                <div className="text-xs font-semibold tracking-wide text-[color:var(--sky)]">
                  AI-first hardware platform
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--ink)] md:text-3xl">
                  An agent that builds, runs,{" "}
                  <span className="text-[color:var(--sky)]">and tests.</span>
                </h2>
                <p className="max-w-xl text-[15px] leading-7 text-[color:var(--ink-dim)]">
                  EMWaver&apos;s AI agent doesn&apos;t just write code. It writes the script, generates
                  the UI, runs it on real hardware, interacts with the buttons and sliders it
                  created, reads the results, and iterates fully autonomously.
                </p>
                <p className="max-w-xl text-[15px] leading-7 text-[color:var(--ink-dim)]">
                  In minutes, an agent can build a complete dashboard for a temperature sensor,
                  accelerometer, or any SPI/I2C module you attach, then validate the behavior on
                  the real device instead of stopping at code generation.
                </p>

                <div className="space-y-3 pt-2">
                  <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
                    <div className="text-xs font-semibold text-[color:var(--sky)]">Electronics Language Models</div>
                    <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                      We&apos;re training <strong className="text-[color:var(--ink)]">ELMs</strong> — foundation models finetuned specifically for hardware control, bus protocols, and the EMWaver scripting ecosystem.
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.65)] p-5 backdrop-blur-md shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
                <div className="flex items-center justify-between gap-4">
                  <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">
                    Agent workflow
                  </div>
                  <div className="text-[11px] text-[color:var(--ink-dim)]">prompt → script → test → iterate</div>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-4">
                    <div className="font-mono text-[12px] leading-6 text-[color:var(--ink)]">
                      <div className="text-[color:var(--aqua)]">You</div>
                      <div>&quot;Build a UI for this RC522 module. Read cards, show UID, write blocks.&quot;</div>
                      <div className="mt-2 text-[color:var(--sky)]">Agent</div>
                      <div>Writes the SPI init and RFID commands, builds the UI, runs it, scans a test card, verifies the UID appears, then refines the flow.</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-4">
                    <div className="font-mono text-[12px] leading-6 text-[color:var(--ink)]">
                      <div className="text-[color:var(--aqua)]">You</div>
                      <div>&quot;Capture the IR signal from my TV remote and replay it.&quot;</div>
                      <div className="mt-2 text-[color:var(--sky)]">Agent</div>
                      <div>Configures the sampler, captures the waveform, saves the artifact, and builds a one-tap retransmit control.</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-4">
                    <div className="font-mono text-[12px] leading-6 text-[color:var(--ink)]">
                      <div className="text-[color:var(--aqua)]">You</div>
                      <div>&quot;Probe this I2C bus and build a dashboard for whatever you find.&quot;</div>
                      <div className="mt-2 text-[color:var(--sky)]">Agent</div>
                      <div>Scans addresses, identifies the sensor, builds a bring-up UI with live readings, then tests the controls against hardware.</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── VS FLIPPER ZERO ─── */}
        <section className="mx-auto max-w-6xl px-5 pb-14">
          <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-6 md:p-10 backdrop-blur-md">
            <div className="grid gap-10 md:grid-cols-2 md:items-center">
              <div className="space-y-5">
                <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--ink)] md:text-3xl">
                  Why EMWaver over Flipper Zero or Arduino?
                </h2>
                <p className="text-[15px] leading-7 text-[color:var(--ink-dim)]">
                  EMWaver is not a Flipper clone and not a traditional microcontroller workflow.
                  By offloading UI and compute to the host, it avoids the tiny-screen constraints of
                  handheld tools and the build-upload loop of Arduino-style development.
                </p>
              </div>

              <div className="overflow-hidden rounded-2xl border border-[color:var(--line)]">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[color:var(--surface-2)] text-[color:var(--ink)]">
                    <tr>
                      <th className="px-4 py-3 font-semibold"></th>
                      <th className="px-4 py-3 font-semibold text-[color:var(--aqua)]">EMWaver</th>
                      <th className="px-4 py-3 font-semibold text-[color:var(--ink-dim)]">Flipper Zero</th>
                      <th className="px-4 py-3 font-semibold text-[color:var(--ink-dim)]">Arduino</th>
                    </tr>
                  </thead>
                  <tbody className="text-[color:var(--ink-dim)]">
                    <tr className="border-t border-[color:var(--line)]">
                      <td className="px-4 py-2.5 font-medium text-[color:var(--ink)]">Display</td>
                      <td className="px-4 py-2.5 text-[color:var(--aqua)]">Full host screen</td>
                      <td className="px-4 py-2.5">128x64 monochrome</td>
                      <td className="px-4 py-2.5">None by default</td>
                    </tr>
                    <tr className="border-t border-[color:var(--line)]">
                      <td className="px-4 py-2.5 font-medium text-[color:var(--ink)]">Storage</td>
                      <td className="px-4 py-2.5 text-[color:var(--aqua)]">Unlimited (host)</td>
                      <td className="px-4 py-2.5">SD card</td>
                      <td className="px-4 py-2.5">Very limited on-board</td>
                    </tr>
                    <tr className="border-t border-[color:var(--line)]">
                      <td className="px-4 py-2.5 font-medium text-[color:var(--ink)]">AI agent</td>
                      <td className="px-4 py-2.5 text-[color:var(--aqua)]">Built-in</td>
                      <td className="px-4 py-2.5">None</td>
                      <td className="px-4 py-2.5">None</td>
                    </tr>
                    <tr className="border-t border-[color:var(--line)]">
                      <td className="px-4 py-2.5 font-medium text-[color:var(--ink)]">Connectivity</td>
                      <td className="px-4 py-2.5 text-[color:var(--aqua)]">Host + cloud</td>
                      <td className="px-4 py-2.5">BLE only</td>
                      <td className="px-4 py-2.5">Serial</td>
                    </tr>
                    <tr className="border-t border-[color:var(--line)]">
                      <td className="px-4 py-2.5 font-medium text-[color:var(--ink)]">Development</td>
                      <td className="px-4 py-2.5 text-[color:var(--aqua)]">Instant scripts</td>
                      <td className="px-4 py-2.5">Firmware build/flash</td>
                      <td className="px-4 py-2.5">Sketch compile/upload</td>
                    </tr>
                    <tr className="border-t border-[color:var(--line)]">
                      <td className="px-4 py-2.5 font-medium text-[color:var(--ink)]">Price</td>
                      <td className="px-4 py-2.5 text-[color:var(--aqua)]">Inexpensive</td>
                      <td className="px-4 py-2.5">~$170</td>
                      <td className="px-4 py-2.5">Inexpensive</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* ─── CLOUD + REMOTE CONTROL ─── */}
        <section className="mx-auto max-w-6xl px-5 pb-14">
          <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-6 md:p-10 backdrop-blur-md">
            <div className="grid gap-10 md:grid-cols-2 md:items-center">
              <div className="space-y-5">
                <div className="text-xs font-semibold tracking-wide text-[color:var(--sky)]">
                  Control from anywhere
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--ink)] md:text-3xl">
                  Your lab, accessible from anywhere on Earth.
                </h2>
                <p className="text-[15px] leading-7 text-[color:var(--ink-dim)]">
                  Plug an EMWaver into a $35 Raspberry Pi in your lab.
                  Control it from your couch, from the office, or from another continent.
                  Hosts controlling EMWaver devices can be controlled by other hosts — forming
                  a fully connected cloud of hardware.
                </p>
                <div className="flex flex-wrap gap-2 pt-1 text-xs text-[color:var(--ink-dim)]">
                  <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1">
                    Remote host sessions
                  </div>
                  <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1">
                    Cross-device control
                  </div>
                  <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1">
                    Cloud script sync
                  </div>
                </div>
              </div>

              <div className="space-y-4 rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.55)] p-6 backdrop-blur-md">
                <div className="text-xs font-semibold text-[color:var(--ink-dim)]">How it works</div>
                <div className="space-y-4 text-sm text-[color:var(--ink-dim)]">
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 rounded-full bg-[color:var(--surface-2)] px-2.5 py-1 text-xs font-semibold text-[color:var(--sky)]">1</div>
                    <div>Plug EMWaver into any host (phone, laptop, RPi)</div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 rounded-full bg-[color:var(--surface-2)] px-2.5 py-1 text-xs font-semibold text-[color:var(--sky)]">2</div>
                    <div>Host connects to EMWaver Cloud automatically</div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 rounded-full bg-[color:var(--surface-2)] px-2.5 py-1 text-xs font-semibold text-[color:var(--sky)]">3</div>
                    <div>Control from any other device — same account, any platform</div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 rounded-full bg-[color:var(--surface-2)] px-2.5 py-1 text-xs font-semibold text-[color:var(--sky)]">4</div>
                    <div>AI agents can also connect and drive experiments autonomously</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── EVERY PLATFORM ─── */}
        <section className="mx-auto max-w-6xl px-5 pb-14">
          <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-6 md:p-10 backdrop-blur-md text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--ink)] md:text-3xl">
              One device. Every platform.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-[15px] leading-7 text-[color:var(--ink-dim)]">
              EMWaver apps are native on every platform. Same scripts, same experience,
              everywhere.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-6">
              <a href="https://apps.apple.com" target="_blank" rel="noreferrer">
                <img src="/badges/app-store.png" alt="App Store" className="h-11 w-auto" />
              </a>
              <a href="https://play.google.com" target="_blank" rel="noreferrer">
                <img src="/badges/google-play.png" alt="Google Play" className="h-11 w-auto" />
              </a>
              <a href="https://apps.apple.com" target="_blank" rel="noreferrer">
                <img src="/badges/macos.png" alt="macOS" className="h-11 w-auto" />
              </a>
              <a href="https://apps.microsoft.com" target="_blank" rel="noreferrer">
                <img src="/badges/windows.png" alt="Windows" className="h-11 w-auto" />
              </a>
            </div>
          </div>
        </section>

        {/* ─── CTA ─── */}
        <section className="mx-auto max-w-6xl px-5 pb-16">
          <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-6 md:p-10 backdrop-blur-md">
            <div className="flex items-end justify-between gap-6">
              <div>
                <div className="text-xs font-semibold tracking-wide text-[color:var(--aqua)]">
                  Get started
                </div>
                <h2 className="pt-2 text-2xl font-semibold tracking-tight text-[color:var(--ink)] md:text-3xl">
                  Ready to reimagine electronics?
                </h2>
                <p className="pt-2 max-w-2xl text-[15px] leading-7 text-[color:var(--ink-dim)]">
                  Build a supported board, install the app, and start exploring. It&apos;s that simple.
                </p>
              </div>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <Link
                href="/build"
                className="group rounded-2xl border border-[color:var(--line)] bg-[rgba(78,231,199,0.08)] p-5 hover:bg-[rgba(78,231,199,0.12)]"
              >
                <div className="text-xs font-semibold text-[color:var(--aqua)]">Step 1</div>
                <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
                  Open Build
                </div>
                <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                  Pick a supported board and open the build files.
                </div>
              </Link>

              <Link
                href="/install"
                className="group rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
              >
                <div className="text-xs font-semibold text-[color:var(--sky)]">Step 2</div>
                <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
                  Install the app
                </div>
                <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                  Available on App Store, Play Store, and more.
                </div>
              </Link>

              <Link
                href="/scripts"
                className="group rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
              >
                <div className="text-xs font-semibold text-[color:var(--copper)]">Step 3</div>
                <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
                  Start hacking
                </div>
                <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                  Run scripts, plug in modules, explore hardware.
                </div>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
