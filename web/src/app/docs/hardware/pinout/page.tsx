import Image from "next/image";
import { getCurrentBoards, type HardwareDevice } from "@/lib/hardwareCatalog";

function getMcuLabel(device: HardwareDevice): string {
  const tags = device.tags.map((tag) => tag.toLowerCase());
  const requires = device.requires.map((item) => item.toLowerCase());
  const description = device.description.toLowerCase();

  if (
    device.group === "esp32" ||
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

  return "Managed target";
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

export default function PinoutDocPage() {
  const devices = getCurrentBoards();

  return (
    <>
      <h1>Pinout</h1>
      <p>
        Pinouts are maintained in the device repositories, not mirrored in this
        docs page. Use the cards below to open the relevant GitHub repo README
        for each current EMWaver device.
      </p>

      <div className="mt-6 grid gap-4">
        {devices.map((device) => (
          <div
            key={device.slug}
            className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5"
          >
            <div className="flex flex-wrap items-start gap-4">
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--image-well)]">
                <Image
                  src={device.image}
                  alt={device.title}
                  fill
                  unoptimized
                  className="object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold text-[color:var(--ink)]">
                  {device.title}
                </div>
                <div className="mt-1 text-xs text-[color:var(--ink-dim)]">
                  MCU: {getMcuLabel(device)}
                </div>
                <p className="mt-3 text-sm leading-6 text-[color:var(--ink-dim)]">
                  {device.description}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {device.githubUrl ? (
                    <a
                      href={`${device.githubUrl}#readme`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-3)] px-4 py-2 text-sm font-medium text-[color:var(--ink)] no-underline hover:bg-[color:var(--surface-2)]"
                    >
                      <GithubIcon />
                      Pinout
                    </a>
                  ) : (
                    <div className="inline-flex items-center rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-3)] px-4 py-2 text-sm text-[color:var(--ink-dim)]">
                      Pinout coming soon
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
