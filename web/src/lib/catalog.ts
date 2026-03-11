import fs from "fs";
import path from "path";

export type DeviceInfo = {
  slug: string;
  title: string;
  displayTitle: string;
  group: string;
  status?: string;
  lifecycle?: string;
  experimental?: boolean;
  image: string;
  images?: string[];
  casingImage?: string;
  designDate?: string;
  description: string;
  tags?: string[];
  requires?: string[];
  parent?: string;
  appSupport?: string[];
  oshwLabUrl?: string;
  easyEdaUrl?: string;
  githubUrl?: string;
  schematicUrl?: string;
  reproductionCost?: { amount: number; currency: string; units: number } | null;
};

const CATALOG_DIR = path.join(
  process.cwd(),
  "public/hardware-catalog/hardware",
);

export function resolveImagePath(slug: string, imagePath: string): string {
  if (imagePath.includes("/"))
    return `/hardware-catalog/hardware/${imagePath}`;
  return `/hardware-catalog/hardware/${slug}/${imagePath}`;
}

export function loadDeviceList(): string[] {
  const raw = fs.readFileSync(
    path.join(CATALOG_DIR, "devices.json"),
    "utf-8",
  );
  return JSON.parse(raw) as string[];
}

export function loadDevice(slug: string): DeviceInfo | null {
  const file = path.join(CATALOG_DIR, slug, "device.json");
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf-8");
  const data = JSON.parse(raw);
  return { slug, ...data } as DeviceInfo;
}

export function loadAllDevices(): DeviceInfo[] {
  const slugs = loadDeviceList();
  return slugs
    .map((slug) => loadDevice(slug))
    .filter((d): d is DeviceInfo => d !== null);
}

type CategorizedDevices = {
  featured: DeviceInfo[];
  boards: DeviceInfo[];
  modules: DeviceInfo[];
  archive: DeviceInfo[];
};

export function categorizeDevices(devices: DeviceInfo[]): CategorizedDevices {
  const featured: DeviceInfo[] = [];
  const boards: DeviceInfo[] = [];
  const modules: DeviceInfo[] = [];
  const archive: DeviceInfo[] = [];

  for (const device of devices) {
    const isOld =
      device.lifecycle === "old" ||
      device.status === "old" ||
      (device.experimental && device.status !== "production" && device.status !== "current");

    if (isOld) {
      archive.push(device);
      continue;
    }

    if (
      device.status === "production" ||
      device.status === "current"
    ) {
      featured.push(device);
      continue;
    }

    if (device.group === "module" || device.status === "module") {
      modules.push(device);
      continue;
    }

    boards.push(device);
  }

  return { featured, boards, modules, archive };
}
