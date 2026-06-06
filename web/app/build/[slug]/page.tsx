import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/emwaver/SiteHeader";
import { DeviceGallery } from "@/app/build/[slug]/DeviceGallery";
import {
  getHardwareCatalog,
  getHardwareDevice,
  type BuildAsset,
  type HardwareDevice,
} from "@/lib/emwaver/hardwareCatalog";

export function generateStaticParams() {
  return getHardwareCatalog().map((device) => ({ slug: device.slug }));
}

function formatDesignDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function ExternalLink({
  href,
  label,
  download,
  disabled = false,
}: {
  href: string | null;
  label: string;
  download?: boolean;
  disabled?: boolean;
}) {
  const className =
    "rounded-xl border px-4 py-2.5 text-sm font-semibold transition";

  if (!href || disabled) {
    return (
      <span
        aria-disabled="true"
        className={`${className} cursor-not-allowed border-[color:var(--line)] bg-[color:var(--surface-3)] text-[color:var(--ink-dim)] opacity-70`}
      >
        {label}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      download={download}
      className={`${className} border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]`}
    >
      {label}
    </a>
  );
}

function BuildAssetButton({ asset }: { asset: BuildAsset }) {
  const isDownload = asset.mode === "download";
  return (
    <ExternalLink
      href={asset.href}
      label={
        asset.available
          ? `${isDownload ? "Download" : "Open"} ${asset.label}`
          : `${asset.label} coming soon`
      }
      download={isDownload && asset.available}
      disabled={!asset.available}
    />
  );
}

function GithubIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4 fill-current"
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.2-.02-2.17-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.72.08-.71.08-.71 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.68 1.25 3.33.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.27-5.24-5.68 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.18-1.49 3.14-1.18 3.14-1.18.62 1.59.23 2.76.11 3.05.73.8 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.26 5.67.41.35.78 1.04.78 2.1 0 1.52-.01 2.74-.01 3.12 0 .31.21.68.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function getMcuLabel(device: HardwareDevice): string | null {
  const tags = device.tags.map((tag) => tag.toLowerCase());
  const requires = device.requires.map((item) => item.toLowerCase());
  const description = device.description.toLowerCase();

  if (device.group === "esp32") {
    if (tags.includes("esp32-s3") || description.includes("esp32-s3")) return "ESP32-S3";
    if (tags.includes("esp32-s2") || description.includes("esp32-s2")) return "ESP32-S2";
    if (tags.includes("esp8266")) return "ESP8266";
    return "ESP32";
  }

  if (
    tags.includes("esp32-s3") ||
    requires.some((item) => item.includes("esp32-s3")) ||
    description.includes("esp32-s3")
  ) {
    return "ESP32-S3";
  }

  if (
    device.group === "stm32" ||
    tags.includes("stm32f042") ||
    description.includes("stm32f042") ||
    device.parent === "GPIO_WAVER"
  ) {
    return "STM32F042";
  }

  return null;
}

export default async function BuildDevicePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const device = getHardwareDevice(slug);
  if (!device) notFound();

  const hasAnyBuildAsset = device.buildAssets.some((asset) => asset.available);
  const mcuLabel = getMcuLabel(device);
  const designDate = formatDesignDate(device.designDate);

  const specs: { label: string; value: string }[] = [];
  if (mcuLabel) specs.push({ label: "MCU", value: mcuLabel });
  if (designDate) specs.push({ label: "Design date", value: designDate });
  if (device.reproductionCost) {
    specs.push({
      label: "Reproduction cost",
      value: `${device.reproductionCost.currency === "USD" ? "$" : ""}${device.reproductionCost.amount} / ${device.reproductionCost.units} units`,
    });
  }

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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-4xl">
                  {device.title}
                </h1>
                {(device.publicHardwareUrl || device.githubUrl) && (
                  <div className="flex flex-wrap justify-end gap-2">
                    {device.publicHardwareUrl && (
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
                    )}
                    {device.githubUrl && (
                      <a
                        href={device.githubUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${device.title} GitHub repository`}
                        className="inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1.5 text-[11px] font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface-2)]"
                      >
                        <GithubIcon />
                        GitHub
                      </a>
                    )}
                  </div>
                )}
              </div>
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

            {specs.length > 0 && (
              <dl className="divide-y divide-[color:var(--line)] border-y border-[color:var(--line)]">
                {specs.map((spec) => (
                  <div
                    key={spec.label}
                    className="flex items-baseline justify-between gap-4 py-3"
                  >
                    <dt className="text-sm text-[color:var(--ink-dim)]">
                      {spec.label}
                    </dt>
                    <dd className="text-sm font-medium text-[color:var(--ink)]">
                      {spec.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            <div>
              <div className="text-sm font-semibold text-[color:var(--ink)]">
                Build files
              </div>
              <p className="pt-2 text-sm leading-6 text-[color:var(--ink-dim)]">
                Open the build resources for this device on GitHub. Exact file
                links can download directly from the hardware repo; otherwise the
                buttons open the repo or the relevant build folder there.
              </p>

              <div className="mt-4 flex flex-wrap gap-3">
                {device.buildAssets.map((asset) => (
                  <BuildAssetButton key={asset.key} asset={asset} />
                ))}
              </div>

              {!hasAnyBuildAsset && (
                <p className="pt-4 text-xs text-[color:var(--ink-dim)]">
                  This device does not expose build resources yet.
                </p>
              )}
            </div>
          </div>
        </div>

      </main>

    </div>
  );
}
