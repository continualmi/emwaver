import Image from "next/image";
import Link from "next/link";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { BuilderClient } from "@/app/hardware/BuilderClient";
import {
  getCurrentBoards,
  getExperimentalDevices,
  getFeaturedHardware,
  getModuleDevices,
  getPreviousBoards,
} from "@/lib/hardwareCatalog";

function HardwareCard({
  href,
  image,
  title,
  description,
  meta,
}: {
  href: string;
  image: string;
  title: string;
  description: string;
  meta: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-4 transition hover:bg-[rgba(255,255,255,0.06)]"
    >
      <div className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[rgba(3,7,18,0.45)]">
        <div className="relative h-48 w-full">
          <Image src={image} alt={title} fill unoptimized className="object-cover transition duration-300 group-hover:scale-[1.02]" />
        </div>
      </div>
      <div className="pt-4 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--sky)]">{meta}</div>
      <div className="pt-2 text-xl font-semibold text-[color:var(--ink)]">{title}</div>
      <div className="pt-2 text-sm leading-6 text-[color:var(--ink-dim)]">{description || "Description coming soon."}</div>
    </Link>
  );
}

function HardwareSection({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: ReturnType<typeof getFeaturedHardware>;
}) {
  if (!items.length) return null;

  return (
    <section className="mt-12">
      <div className="max-w-3xl">
        <div className="text-2xl font-semibold text-[color:var(--ink)]">{title}</div>
        <div className="pt-2 text-[15px] leading-7 text-[color:var(--ink-dim)]">{description}</div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <HardwareCard
            key={item.slug}
            href={`/hardware/${item.slug}`}
            image={item.image}
            title={item.title}
            description={item.description}
            meta={item.group === "module" ? "Module" : "STM32"}
          />
        ))}
      </div>
    </section>
  );
}

export default function HardwarePage() {
  const featured = getFeaturedHardware();
  const currentBoards = getCurrentBoards();
  const modules = getModuleDevices();
  const previousBoards = getPreviousBoards();
  const experimental = getExperimentalDevices();

  return (
    <div className="min-h-dvh docs-mode">
      <SiteHeader />

      <main className="w-full px-5 py-10">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1 text-xs text-[color:var(--ink-dim)]">
              <span className="inline-block h-2 w-2 rounded-full bg-[color:var(--aqua)]" />
              Hardware catalog and build path
            </div>

            <h1 className="pt-5 text-4xl font-semibold tracking-tight text-[color:var(--ink)] md:text-6xl">
              Browse the boards, then build from JLCPCB-oriented files
            </h1>

            <p className="max-w-2xl pt-5 text-[15px] leading-7 text-[color:var(--ink-dim)]">
              This is the practical route while direct device sales are still marked coming soon.
              Browse the current EMWaver boards, inspect the historical hardware catalog, and use
              the builder flow for BOM, fabrication files, and JLCPCB-oriented output.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/hardware/EMWAVER_DIY" className="rounded-2xl bg-[color:var(--ink)] px-4 py-3 text-sm font-semibold text-[color:var(--paper)] transition hover:opacity-95">
                Open EMWaver DIY
              </Link>
              <Link href="/order" className="rounded-2xl border border-[color:var(--line)] bg-[rgba(240,166,106,0.10)] px-4 py-3 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[rgba(240,166,106,0.14)]">
                Device availability
              </Link>
              <Link href="/docs/hardware/device" className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-3 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface-2)]">
                Current device docs
              </Link>
            </div>
          </div>

          <div className="mt-10">
            <BuilderClient />
          </div>

          <HardwareSection
            title="Featured"
            description="The main STM32 boards and modules worth surfacing first."
            items={featured}
          />

          <HardwareSection
            title="Current boards"
            description="Primary STM32 boards from the catalog."
            items={currentBoards}
          />

          <HardwareSection
            title="Modules"
            description="Add-on modules and experimental connectors that sit inside the STM32 hardware ecosystem."
            items={modules}
          />

          <HardwareSection
            title="Previous revisions"
            description="Archived STM32 board revisions that still belong in the hardware history."
            items={previousBoards}
          />

          <HardwareSection
            title="Experimental"
            description="Historical experimental entries kept visible instead of dropping them from the catalog."
            items={experimental}
          />
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
