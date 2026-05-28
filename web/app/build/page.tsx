import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "@/components/emwaver/SiteHeader";
import { CatalogImage } from "@/components/emwaver/CatalogImage";
import {
  getCurrentBoards,
  getArchiveDevices,
  type HardwareDevice,
} from "@/lib/emwaver/hardwareCatalog";
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
    name: "ESP32 family",
    description:
      "ESP32, ESP32-S2, and ESP32-S3 MCU families used for EMWaver wireless-capable targets and DIY builds. ESP32-S3 is the best fit when you want USB, BLE, and Wi-Fi on the same device. ESP32-S2 supports USB and Wi-Fi. Classic ESP32 supports Wi-Fi and BLE.",
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
    <div className="group relative overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface-3)] transition hover:bg-[color:var(--surface-2)]">
      <Link
        href={`/build/${device.slug}`}
        aria-label={`Open ${device.title}`}
        className="absolute inset-0 z-10"
      />
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[color:var(--image-well)]">
        <CatalogImage
          src={device.image}
          alt={device.title}
          className="h-full w-full object-cover transition group-hover:scale-[1.02]"
        />
      </div>
      <div className="relative z-10 pointer-events-none p-4">
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
        {device.publicHardwareUrl && (
          <div className="pointer-events-auto relative z-20 mt-3 flex justify-end">
            <div className="flex flex-wrap justify-end gap-2">
              <a
                href={device.publicHardwareUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${device.title} hardware folder`}
                className="inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1.5 text-[11px] font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface-2)]"
              >
                <GithubIcon />
                Hardware
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GithubIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 fill-current"
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.2-.02-2.17-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.72.08-.71.08-.71 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.68 1.25 3.33.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.27-5.24-5.68 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.18-1.49 3.14-1.18 3.14-1.18.62 1.59.23 2.76.11 3.05.73.8 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.26 5.67.41.35.78 1.04.78 2.1 0 1.52-.01 2.74-.01 3.12 0 .31.21.68.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
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
            firmware toolchains, no build-flash loops. Start with an ESP32-family
            board (ESP32, ESP32-S2, or ESP32-S3) and the EMWaver app, then explore
            hardware directly. If you want to go
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

        {/* ─── EMWAVER LINEUP (with images) ─── */}
        <DeviceSection
          title="EMWaver lineup"
          subtitle="The EMWaver devices we actively build and use today."
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
