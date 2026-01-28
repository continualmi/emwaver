import fs from "fs/promises";
import path from "path";
import type { HardwareCatalogDevice, HardwareCatalogManifest } from "@/lib/hardwareCatalog/types";

const BASE_DIR = path.join(process.cwd(), "public", "hardware-catalog");
const HW_DIR = path.join(BASE_DIR, "hardware");

export async function loadHardwareManifest(): Promise<HardwareCatalogManifest> {
  const p = path.join(HW_DIR, "devices.json");
  const raw = await fs.readFile(p, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("hardware/devices.json must be an array");
  return parsed.map((x) => String(x));
}

export async function loadHardwareDevice(folder: string): Promise<HardwareCatalogDevice> {
  const p = path.join(HW_DIR, folder, "device.json");
  const raw = await fs.readFile(p, "utf-8");
  const parsed = JSON.parse(raw) as Omit<HardwareCatalogDevice, "folder">;
  return { folder, ...parsed };
}
