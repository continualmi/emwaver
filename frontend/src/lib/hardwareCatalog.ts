import fs from "node:fs";
import path from "node:path";

export type HardwareDevice = {
  slug: string;
  title: string;
  group: string;
  status: string;
  experimental: boolean;
  description: string;
  image: string;
  images: string[];
  tags: string[];
  appSupport: string[];
  parent: string | null;
  requires: string[];
  designDate: string | null;
  reproductionCost: { amount?: number; currency?: string; units?: number } | null;
  oshwLabUrl: string | null;
  easyEdaUrl: string | null;
  onshapeUrl: string | null;
  schematicUrl: string | null;
  githubUrl: string | null;
};

type DeviceManifest = Partial<HardwareDevice> & {
  displayTitle?: string;
};

const PUBLIC_ROOT = path.join(process.cwd(), "public", "hardware-catalog", "hardware");
const MANIFEST_FILE = path.join(PUBLIC_ROOT, "devices.json");

const STM32_MODULE_IDS = new Set([
  "EMW1",
  "GPIO_WAVER_MODULE",
  "DUPLEX_WAVER_MODULE",
  "RFID_WAVER",
]);

const FEATURED_IDS = ["emwaver", "ISM_WAVER", "GPIO_WAVER", "INFRARED_WAVER", "RFID_WAVER", "EMW1"];

const CURRENT_BOARD_IDS = ["emwaver", "ISM_WAVER", "GPIO_WAVER", "INFRARED_WAVER"];

function normalizeString(value: unknown): string {
  return String(value || "").trim();
}

function ensureImagePath(slug: string, value: unknown): string {
  const raw = normalizeString(value);
  if (!raw) return `/hardware-catalog/hardware/${slug}/${slug}.png`;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (raw.startsWith("/hardware-catalog/")) return raw;
  if (raw.startsWith("hardware/")) return `/hardware-catalog/${raw}`;
  if (raw.startsWith("downloads/")) return `/hardware-catalog/${raw}`;
  if (raw.includes("/")) return `/hardware-catalog/hardware/${raw}`;
  return `/hardware-catalog/hardware/${slug}/${raw}`;
}

function parseManifest(slug: string): HardwareDevice {
  const file = path.join(PUBLIC_ROOT, slug, "device.json");
  const raw = fs.readFileSync(file, "utf8");
  const data = JSON.parse(raw) as DeviceManifest;

  const images = Array.isArray(data.images) ? data.images : [];
  const normalizedImages = Array.from(
    new Set(images.map((value) => ensureImagePath(slug, value)).filter(Boolean)),
  );

  const primaryImage =
    normalizedImages[0] || ensureImagePath(slug, data.image || `${slug}.png`);

  return {
    slug,
    title: normalizeString(data.displayTitle || data.title || slug),
    group: normalizeString(data.group),
    status: normalizeString(data.status || "device"),
    experimental: Boolean(data.experimental),
    description: normalizeString(data.description),
    image: primaryImage,
    images: normalizedImages.length ? normalizedImages : [primaryImage],
    tags: Array.isArray(data.tags) ? data.tags.map((value) => normalizeString(value)).filter(Boolean) : [],
    appSupport: Array.isArray(data.appSupport)
      ? data.appSupport.map((value) => normalizeString(value)).filter(Boolean)
      : [],
    parent: normalizeString(data.parent) || null,
    requires: Array.isArray(data.requires)
      ? data.requires.map((value) => normalizeString(value)).filter(Boolean)
      : [],
    designDate: normalizeString(data.designDate) || null,
    reproductionCost:
      data.reproductionCost && typeof data.reproductionCost === "object" ? data.reproductionCost : null,
    oshwLabUrl: normalizeString(data.oshwLabUrl) || null,
    easyEdaUrl: normalizeString(data.easyEdaUrl) || null,
    onshapeUrl: normalizeString(data.onshapeUrl) || null,
    schematicUrl: normalizeString(data.schematicUrl) || null,
    githubUrl: normalizeString(data.githubUrl) || null,
  };
}

function shouldKeepDevice(slug: string, device: HardwareDevice): boolean {
  if (device.group === "stm32") return true;
  if (device.group !== "module") return false;
  return STM32_MODULE_IDS.has(slug);
}

function loadAllDevices(): HardwareDevice[] {
  const ids = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8")) as string[];
  return ids
    .map((slug) => parseManifest(slug))
    .filter((device) => shouldKeepDevice(device.slug, device))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function getHardwareCatalog(): HardwareDevice[] {
  return loadAllDevices();
}

export function getHardwareDevice(slug: string): HardwareDevice | null {
  return getHardwareCatalog().find((device) => device.slug === slug) || null;
}

export function getFeaturedHardware(): HardwareDevice[] {
  const devices = getHardwareCatalog();
  return FEATURED_IDS.map((slug) => devices.find((device) => device.slug === slug)).filter(
    (device): device is HardwareDevice => Boolean(device),
  );
}

export function getCurrentBoards(): HardwareDevice[] {
  const devices = getHardwareCatalog();
  return CURRENT_BOARD_IDS.map((slug) => devices.find((device) => device.slug === slug)).filter(
    (device): device is HardwareDevice => Boolean(device),
  );
}

export function getPreviousBoards(): HardwareDevice[] {
  return getHardwareCatalog().filter(
    (device) => device.group === "stm32" && !CURRENT_BOARD_IDS.includes(device.slug) && !device.experimental,
  );
}

export function getModuleDevices(): HardwareDevice[] {
  return getHardwareCatalog().filter((device) => device.group === "module");
}

export function getExperimentalDevices(): HardwareDevice[] {
  return getHardwareCatalog().filter((device) => device.experimental);
}

export function getRelatedHardware(device: HardwareDevice): HardwareDevice[] {
  const devices = getHardwareCatalog();
  return devices.filter(
    (candidate) =>
      candidate.slug !== device.slug &&
      (candidate.parent === device.slug || device.parent === candidate.slug || candidate.group === device.group),
  );
}
