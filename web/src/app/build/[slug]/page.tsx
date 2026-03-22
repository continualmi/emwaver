import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { DeviceGallery } from "@/app/build/[slug]/DeviceGallery";
import {
  getHardwareDevice,
} from "@/lib/hardwareCatalog";

function ExternalLink({
  href,
  label,
  download,
}: {
  href: string | null;
  label: string;
  download?: boolean;
}) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      download={download}
      className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2.5 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface-2)]"
    >
      {label}
    </a>
  );
}

export default async function BuildDevicePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const device = getHardwareDevice(slug);
  if (!device) notFound();

  const links = [
    { href: device.oshwLabUrl, label: "OSHW Lab" },
    { href: device.easyEdaUrl, label: "EasyEDA" },
    { href: device.schematicUrl, label: "Schematic" },
    { href: device.githubUrl, label: "GitHub" },
  ].filter((l) => l.href);
  const hasCaseSection =
    Boolean(device.casingImage) ||
    Boolean(device.onshapeUrl) ||
    device.caseDownloads.length > 0;

  return (
    <div className="min-h-dvh">
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-5 py-10">
        <div className="pb-4">
          <Link
            href="/build"
            className="text-sm text-[color:var(--ink-dim)] hover:text-[color:var(--ink)]"
          >
            &larr; Back to Build
          </Link>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          {/* Images */}
          <div className="space-y-4">
            <DeviceGallery
              images={device.images.length ? device.images : [device.image]}
              title={device.title}
            />
          </div>

          {/* Info */}
          <div className="space-y-6">
            <div>
              {device.experimental && (
                <span className="mb-2 inline-block rounded-full border border-[color:var(--line)] bg-[color:var(--copper-tint-2)] px-3 py-1 text-[11px] font-semibold text-[color:var(--copper)]">
                  Experimental
                </span>
              )}
              <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-4xl">
                {device.title}
              </h1>
              <p className="max-w-lg pt-3 text-[15px] leading-7 text-[color:var(--ink-dim)]">
                {device.description}
              </p>
            </div>

            {device.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {device.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1 text-xs text-[color:var(--ink-dim)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {device.group && (
                <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-3)] p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ink-dim)]">
                    Group
                  </div>
                  <div className="pt-1 text-sm font-semibold text-[color:var(--ink)]">
                    {device.group}
                  </div>
                </div>
              )}
              {device.designDate && (
                <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-3)] p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ink-dim)]">
                    Design date
                  </div>
                  <div className="pt-1 text-sm font-semibold text-[color:var(--ink)]">
                    {device.designDate}
                  </div>
                </div>
              )}
              {device.reproductionCost && (
                <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-3)] p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ink-dim)]">
                    Reproduction cost
                  </div>
                  <div className="pt-1 text-sm font-semibold text-[color:var(--ink)]">
                    {device.reproductionCost.currency === "USD" ? "$" : ""}
                    {device.reproductionCost.amount} / {device.reproductionCost.units} units
                  </div>
                </div>
              )}
              {device.appSupport.length > 0 && (
                <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-3)] p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ink-dim)]">
                    App support
                  </div>
                  <div className="pt-1 text-sm font-semibold capitalize text-[color:var(--ink)]">
                    {device.appSupport.join(", ")}
                  </div>
                </div>
              )}
            </div>

            {links.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {links.map((link) => (
                  <ExternalLink
                    key={link.label}
                    href={link.href}
                    label={link.label}
                  />
                ))}
              </div>
            )}

            {hasCaseSection && (
              <section className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface-3)] p-5">
                <div className="text-sm font-semibold text-[color:var(--ink)]">
                  Case / enclosure
                </div>
                <p className="pt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
                  Recovered enclosure assets for this board, including case previews,
                  CAD links, and downloadable model files where they still exist in
                  the repo.
                </p>

                {device.casingImage && (
                  <div className="mt-4 overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--image-well)]">
                    <div className="relative aspect-[4/3] w-full">
                      <Image
                        src={device.casingImage}
                        alt={`${device.title} case preview`}
                        fill
                        unoptimized
                        className="object-cover"
                      />
                    </div>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-3">
                  <ExternalLink href={device.onshapeUrl} label="Open in Onshape" />
                  {device.caseDownloads.map((asset) => (
                    <ExternalLink
                      key={asset.href}
                      href={asset.href}
                      label={`Download ${asset.label}`}
                      download
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

      </main>

    </div>
  );
}
