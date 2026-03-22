import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import {
  getCurrentBoards,
  getArchiveDevices,
  type HardwareDevice,
} from "@/lib/hardwareCatalog";
import { BuilderClient } from "@/app/hardware/BuilderClient";

const LANDING_IMAGES = [
  {
    src: "/landing1.jpeg",
    alt: "EMWaver plugged into a smartphone",
    label: "Mobile setup",
  },
  {
    src: "/landing2.png",
    alt: "EMWaver device close-up",
    label: "Device close-up",
  },
  {
    src: "/landing3.png",
    alt: "EMWaver connected to laptop with modules",
    label: "Laptop setup",
  },
];

const SUPPORTED_MCUS = [
  {
    name: "ESP32-S3",
    description:
      "Dual-core MCU family used for EMWaver wireless-capable targets and DIY builds. Best fit when you want USB, BLE, and Wi-Fi on the same device.",
    tags: ["MCU", "Wi-Fi", "BLE", "USB"],
  },
  {
    name: "STM32F042",
    description:
      "The STM32 MCU behind the classic host-backed EMWaver boards. Used for compact USB-first designs such as GPIO, IR, ISM, and related module-driven variants.",
    tags: ["MCU", "USB", "STM32", "Host-backed"],
  },
];

function DeviceCard({ device }: { device: HardwareDevice }) {
  return (
    <Link
      href={`/build/${device.slug}`}
      className="group overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface-3)] transition hover:bg-[color:var(--surface-2)]"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[color:var(--image-well)]">
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
            firmware toolchains, no build-flash loops. Start with an ESP32-S3 and
            the EMWaver app, then explore hardware directly. If you want to go
            further, the hardware catalog below includes fabrication files for
            custom EMWaver boards.
          </p>
        </section>

        {/* ─── LANDING IMAGES GALLERY ─── */}
        <section className="pb-14">
          <div className="grid gap-4 sm:grid-cols-3">
            {LANDING_IMAGES.map((img) => (
              <div
                key={img.src}
                className="group overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface-3)]"
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden">
                  <Image
                    src={img.src}
                    alt={img.alt}
                    fill
                    unoptimized
                    className="object-cover"
                  />
                </div>
                <div className="px-4 py-3">
                  <div className="text-xs font-semibold text-[color:var(--ink-dim)]">
                    {img.label}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ─── SUPPORTED MCUS (text-only callout) ─── */}
        <section className="pb-14">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--aqua)]">
            Supported MCUs
          </h2>
          <p className="pt-2 text-sm text-[color:var(--ink-dim)]">
            EMWaver targets a small set of MCU families and modules, then exposes
            concrete boards and builds on top of them in the catalog below.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {SUPPORTED_MCUS.map((board) => (
              <div
                key={board.name}
                className="rounded-2xl border border-[color:var(--aqua-tint-2)] bg-[color:var(--aqua-tint)] p-5"
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
                      className="rounded-full border border-[color:var(--line)] bg-[color:var(--aqua-tint)] px-2.5 py-0.5 text-[11px] text-[color:var(--aqua)]"
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
            Configure and download fabrication files for the EMWaver STM32 board.
            Choose which sections to include, preview the variant, and download
            matching BOM and Gerber files.
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

    </div>
  );
}
