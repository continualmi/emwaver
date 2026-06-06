import Link from "next/link";
import { CatalogImage } from "@/components/emwaver/CatalogImage";
import { getCurrentBoards, type HardwareDevice } from "@/lib/emwaver/hardwareCatalog";

function getMcuLabel(device: HardwareDevice): string {
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

  return "Managed target";
}

function GithubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

export default function HardwareDocPage() {
  const devices = getCurrentBoards();

  return (
    <>
      <h1>Boards &amp; repos</h1>
      <p>
        EMWaver supports a lineup of managed boards and modules. Each supported
        device can expose build files, schematics, BOMs, Gerbers, and repo docs
        through its GitHub repository and the Build catalog.
      </p>
      <p>
        Users bring their own supported board or module. The app handles
        firmware setup and updates for each supported target, so you do not need a
        manual firmware toolchain workflow.
      </p>
      <p>
        You also do not need to build a custom EMWaver device to get started:
        an off-the-shelf ESP32-family dev board (ESP32, ESP32-S2, or ESP32-S3)
        or ESP8266 board is supported directly by the platform. The EMWaver lineup is there when you want purpose-built
        hardware, add-on modules, or downloadable build files.
      </p>

      <h2>Direct support</h2>
      <h3>Any ESP32-family board <span className="font-normal text-[color:var(--ink-dim)]">— ESP32, ESP32-S2, ESP32-S3</span></h3>
      <p>
        Any supported board built around an ESP32, ESP32-S2, or ESP32-S3 can
        work directly with EMWaver. ESP32-S3 is the best fit when you want
        USB, BLE, and Wi-Fi on the same device. ESP32-S2 supports USB and
        Wi-Fi. Classic ESP32 supports Wi-Fi and BLE. This is the fastest way
        to get started because you do not need to build anything from the
        EMWaver lineup first.
      </p>
      <h3>Any ESP8266 board <span className="font-normal text-[color:var(--ink-dim)]">— Wi-Fi plus USB-serial setup</span></h3>
      <p>
        Supported ESP8266 boards work with EMWaver over Wi-Fi after local setup.
        The USB-serial bridge on common ESP8266 dev boards is used for provisioning
        and recovery, while the board&apos;s Wi-Fi transport handles runtime control.
      </p>
      <h3>Any STM32F042 board</h3>
      <p>
        Any supported board built around an STM32F042 can also work
        directly with EMWaver, especially for the classic USB-first,
        host-backed path used by the original board family.
      </p>

      <h2>EMWaver lineup</h2>
      <div className="mt-4 grid gap-4">
        {devices.map((device) => {
          const mcu = getMcuLabel(device);

          return (
            <div
              key={device.slug}
              className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5"
            >
              <div className="flex flex-wrap items-start gap-4">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--image-well)]">
                  <CatalogImage
                    src={device.image}
                    alt={device.title}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-semibold text-[color:var(--ink)]">
                    {device.title}
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--ink-dim)]">
                    MCU: {mcu}
                  </div>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-[color:var(--ink-dim)]">
                {device.description}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {device.githubUrl ? (
                  <a
                    href={device.githubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-3)] px-4 py-2 text-sm font-medium text-[color:var(--ink)] no-underline hover:bg-[color:var(--surface-2)]"
                  >
                    <GithubIcon />
                    View on GitHub
                  </a>
                ) : (
                  <div className="inline-flex items-center rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-3)] px-4 py-2 text-sm text-[color:var(--ink-dim)]">
                    Repo coming soon
                  </div>
                )}
                <Link
                  href={`/build/${device.slug}`}
                  className="inline-flex items-center rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-3)] px-4 py-2 text-sm font-medium text-[color:var(--ink)] no-underline hover:bg-[color:var(--surface-2)]"
                >
                  Open Build page
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      <h2>Build files</h2>
      <ul>
        <li>Each device page in the Build catalog can expose BOM, CPL / CLP, Gerbers, schematics, PCB docs, and related files.</li>
        <li>The GitHub repo remains the source of truth for device-specific documentation and hardware source files.</li>
      </ul>

      <h2>Pinout reference</h2>
      <p>
        For GPIO numbering, headers, and pin assignments on the EMWaver Shield, see the{" "}
        <Link href="/docs/hardware/pinout">pinout reference</Link>.
      </p>
    </>
  );
}
