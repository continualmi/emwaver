import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { GalleryClient } from "@/app/hardware/GalleryClient";
import { getHardwareCatalog, getHardwareDevice, getRelatedHardware } from "@/lib/hardwareCatalog";

export async function generateStaticParams() {
  return getHardwareCatalog().map((device) => ({ slug: device.slug }));
}

export default async function HardwareDevicePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const device = getHardwareDevice(slug);
  if (!device) notFound();

  const related = getRelatedHardware(device).slice(0, 6);
  const links = [
    device.easyEdaUrl ? { href: device.easyEdaUrl, label: "Open in EasyEDA" } : null,
    device.oshwLabUrl ? { href: device.oshwLabUrl, label: "Open in OSHW Lab" } : null,
    device.onshapeUrl ? { href: device.onshapeUrl, label: "Open in Onshape" } : null,
    device.schematicUrl ? { href: device.schematicUrl, label: "Schematic" } : null,
    device.githubUrl ? { href: device.githubUrl, label: "GitHub" } : null,
  ].filter((item): item is { href: string; label: string } => Boolean(item));

  return (
    <div className="min-h-dvh docs-mode">
      <SiteHeader />
      <main className="w-full px-5 py-10">
        <div className="mx-auto max-w-7xl">
          <Link href="/hardware" className="text-sm text-[color:var(--sky)] hover:underline">
            Back to hardware
          </Link>

          <div className="mt-6 grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
            <GalleryClient images={device.images} title={device.title} />

            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-dim)]">
                  {device.group === "module" ? "Module" : "STM32 board"}
                </span>
                {device.experimental ? (
                  <span className="rounded-full border border-[rgba(91,192,255,0.35)] bg-[rgba(91,192,255,0.10)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--sky)]">
                    Experimental
                  </span>
                ) : null}
              </div>

              <div>
                <h1 className="text-4xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">{device.title}</h1>
                <p className="pt-4 text-[15px] leading-7 text-[color:var(--ink-dim)]">{device.description || "Description coming soon."}</p>
              </div>

              <div className="flex flex-wrap gap-3">
                {links.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-3 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface-2)]"
                  >
                    {link.label}
                  </a>
                ))}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-5">
                  <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">Platform</div>
                  <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">{device.group === "module" ? "Module / add-on" : "STM32-based"}</div>
                  <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                    {device.appSupport.length ? device.appSupport.join(" • ") : "App support metadata not set"}
                  </div>
                </div>

                <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-5">
                  <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">Reproduction</div>
                  <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">
                    {device.reproductionCost?.amount ? `${device.reproductionCost.amount} ${device.reproductionCost.currency || ""}`.trim() : "Not specified"}
                  </div>
                  <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                    {device.reproductionCost?.units ? `${device.reproductionCost.units} units reference batch` : "No historical quote saved"}
                  </div>
                </div>
              </div>

              {device.parent || device.requires.length ? (
                <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-5">
                  <div className="text-sm font-semibold text-[color:var(--ink)]">Dependencies</div>
                  {device.parent ? <div className="pt-3 text-sm text-[color:var(--ink-dim)]">Parent board: {device.parent}</div> : null}
                  {device.requires.length ? <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Requires: {device.requires.join(", ")}</div> : null}
                </div>
              ) : null}

              {device.tags.length ? (
                <div className="flex flex-wrap gap-2">
                  {device.tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-[color:var(--line)] px-3 py-1 text-xs text-[color:var(--ink-dim)]">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {related.length ? (
            <section className="mt-12">
              <div className="text-2xl font-semibold text-[color:var(--ink)]">Related hardware</div>
              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {related.map((item) => (
                  <Link
                    key={item.slug}
                    href={`/hardware/${item.slug}`}
                    className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-4 transition hover:bg-[rgba(255,255,255,0.05)]"
                  >
                    <div className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[rgba(3,7,18,0.45)]">
                      <div className="relative h-44 w-full">
                        <Image src={item.image} alt={item.title} fill unoptimized className="object-cover" />
                      </div>
                    </div>
                    <div className="pt-4 text-lg font-semibold text-[color:var(--ink)]">{item.title}</div>
                    <div className="pt-2 text-sm text-[color:var(--ink-dim)]">{item.description || "Description coming soon."}</div>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
