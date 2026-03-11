import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import {
  getHardwareDevice,
  getRelatedHardware,
  type HardwareDevice,
} from "@/lib/hardwareCatalog";

function ExternalLink({
  href,
  label,
}: {
  href: string | null;
  label: string;
}) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2.5 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface-2)]"
    >
      {label}
    </a>
  );
}

function RelatedCard({ device }: { device: HardwareDevice }) {
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
      </div>
    </Link>
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

  const related = getRelatedHardware(device);

  const links = [
    { href: device.oshwLabUrl, label: "OSHW Lab" },
    { href: device.easyEdaUrl, label: "EasyEDA" },
    { href: device.schematicUrl, label: "Schematic" },
    { href: device.githubUrl, label: "GitHub" },
  ].filter((l) => l.href);

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
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[rgba(3,7,18,0.55)]">
              <Image
                src={device.image}
                alt={device.title}
                fill
                unoptimized
                className="object-cover"
              />
            </div>
            {device.images.length > 1 && (
              <div className="grid grid-cols-4 gap-2">
                {device.images.slice(0, 8).map((src) => (
                  <div
                    key={src}
                    className="relative aspect-square overflow-hidden rounded-xl border border-[color:var(--line)] bg-[rgba(3,7,18,0.55)]"
                  >
                    <Image
                      src={src}
                      alt={device.title}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="space-y-6">
            <div>
              {device.experimental && (
                <span className="mb-2 inline-block rounded-full border border-[color:var(--line)] bg-[rgba(240,166,106,0.12)] px-3 py-1 text-[11px] font-semibold text-[color:var(--copper)]">
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
                <div className="rounded-xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ink-dim)]">
                    Group
                  </div>
                  <div className="pt-1 text-sm font-semibold text-[color:var(--ink)]">
                    {device.group}
                  </div>
                </div>
              )}
              {device.designDate && (
                <div className="rounded-xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ink-dim)]">
                    Design date
                  </div>
                  <div className="pt-1 text-sm font-semibold text-[color:var(--ink)]">
                    {device.designDate}
                  </div>
                </div>
              )}
              {device.reproductionCost && (
                <div className="rounded-xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-4">
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
                <div className="rounded-xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-4">
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
          </div>
        </div>

        {related.length > 0 && (
          <section className="pt-14">
            <h2 className="text-xl font-semibold tracking-tight text-[color:var(--ink)]">
              Related boards
            </h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {related.slice(0, 6).map((d) => (
                <RelatedCard key={d.slug} device={d} />
              ))}
            </div>
          </section>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
