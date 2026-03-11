import Image from "next/image";
import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import {
  getCurrentBoards,
  getArchiveDevices,
  type HardwareDevice,
} from "@/lib/hardwareCatalog";
import { BuilderClient } from "@/app/hardware/BuilderClient";

const SUPPORTED_BOARDS = [
  {
    name: "STM32 BluePill",
    description:
      "Widely available STM32F103 dev board with USB and a rich peripheral set. The most accessible way to get started with EMWaver.",
    tags: ["STM32F103", "USB", "SPI", "I2C", "UART"],
  },
  {
    name: "ESP32-S3",
    description:
      "Wi-Fi and BLE-capable target for autonomous and multi-transport workflows. Ideal for wireless operation without a tethered host.",
    tags: ["ESP32-S3", "Wi-Fi", "BLE", "USB"],
  },
  {
    name: "Arduino Uno / Nano",
    description:
      "Classic ATmega-based boards for simple GPIO, sensor, and bus experiments through the familiar Arduino form factor.",
    tags: ["ATmega328P", "USB", "GPIO"],
  },
];

function DeviceCard({ device }: { device: HardwareDevice }) {
  return (
    <Link
      href={`/build/${device.slug}`}
      className="group overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] transition hover:bg-[rgba(255,255,255,0.07)]"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[rgba(3,7,18,0.55)]">
        <Image
          src={device.image}
          alt={device.title}
          fill
          unoptimized
          className="object-cover transition group-hover:scale-[1.02]"
        />
      </div>
      <div className="p-4">
        <div className="text-sm font-semibold text-[color:var(--ink)]">
          {device.title}
        </div>
        <div className="line-clamp-2 pt-1 text-xs text-[color:var(--ink-dim)]">
          {device.description}
        </div>
        {device.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {device.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-2 py-0.5 text-[10px] text-[color:var(--ink-dim)]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

function DeviceSection({
  title,
  subtitle,
  devices,
}: {
  title: string;
  subtitle?: string;
  devices: HardwareDevice[];
}) {
  if (!devices.length) return null;
  return (
    <section className="pb-12">
      <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--ink)]">
        {title}
      </h2>
      {subtitle && (
        <p className="pt-2 text-sm text-[color:var(--ink-dim)]">{subtitle}</p>
      )}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {devices.map((device) => (
          <DeviceCard key={device.slug} device={device} />
        ))}
      </div>
    </section>
  );
}

export default function BuildPage() {
  const currentBoards = getCurrentBoards();
  const archive = getArchiveDevices();

  return (
    <div className="min-h-dvh">
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-5 py-10">
        {/* ─── HERO ─── */}
        <section className="pb-14">
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">
            Your board. Our platform.
          </h1>
          <p className="max-w-2xl pt-4 text-[16px] leading-8 text-[color:var(--ink-dim)]">
            EMWaver turns supported dev boards into a full electronics lab — no
            firmware toolchains, no build-flash loops. Grab a BluePill, ESP32-S3,
            or Arduino, install the app, and start exploring. For advanced users,
            the hardware catalog below includes open fabrication files to build
            custom EMWaver boards from scratch.
          </p>
        </section>

        {/* ─── SUPPORTED BOARDS (text-only callout) ─── */}
        <section className="pb-14">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--aqua)]">
            Supported boards
          </h2>
          <p className="pt-2 text-sm text-[color:var(--ink-dim)]">
            These dev boards work with EMWaver out of the box. Pick one up, flash
            the managed firmware through the app, and you&apos;re ready.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {SUPPORTED_BOARDS.map((board) => (
              <div
                key={board.name}
                className="rounded-2xl border border-[rgba(78,231,199,0.25)] bg-[rgba(78,231,199,0.06)] p-5"
              >
                <div className="text-base font-semibold text-[color:var(--ink)]">
                  {board.name}
                </div>
                <div className="pt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
                  {board.description}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {board.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-[color:var(--line)] bg-[rgba(78,231,199,0.08)] px-2.5 py-0.5 text-[11px] text-[color:var(--aqua)]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ─── CURRENT BOARDS (with images) ─── */}
        <DeviceSection
          title="Current boards"
          subtitle="The boards we actually build and use today."
          devices={currentBoards}
        />

        {/* ─── BOARD BUILDER ─── */}
        <section className="pb-12">
          <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--ink)]">
            Board builder
          </h2>
          <p className="max-w-2xl pb-6 pt-2 text-sm text-[color:var(--ink-dim)]">
            Configure and download fabrication files for the current STM32
            EMWaver board. Choose which sections to include, preview the variant,
            and download matching BOM and Gerber files.
          </p>
          <BuilderClient />
        </section>

        {/* ─── ARCHIVE (collapsed) ─── */}
        {archive.length > 0 && (
          <section className="border-t border-[color:var(--line)] pt-8 pb-12">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-[color:var(--ink-dim)] hover:text-[color:var(--ink)] [&::-webkit-details-marker]:hidden">
                <span className="transition group-open:rotate-90">&#9654;</span>
                Older designs and prototypes ({archive.length})
              </summary>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {archive.map((device) => (
                  <DeviceCard key={device.slug} device={device} />
                ))}
              </div>
            </details>
          </section>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
