import type { HardwareCatalogDevice } from "@/lib/hardwareCatalog/types";

export function resolveCatalogAsset(deviceId: string, raw: string): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;

  if (/^https?:\/\//i.test(s)) return s;

  const clean = s.startsWith("/") ? s.slice(1) : s;
  if (clean.startsWith("hardware-catalog/")) return `/${clean}`;

  // Match legacy catalog resolver behavior.
  if (clean.startsWith("downloads/")) return `/hardware-catalog/${clean}`;
  if (clean.startsWith("assets/")) return `/hardware-catalog/${clean}`;
  if (clean.startsWith("hardware/")) return `/hardware-catalog/${clean}`;

  if (clean.includes("/")) return `/hardware-catalog/hardware/${clean}`;
  return `/hardware-catalog/hardware/${deviceId}/${clean}`;
}

export function resolveDeviceHero(device: HardwareCatalogDevice): string {
  const raw =
    String(device.image || "").trim() ||
    (Array.isArray(device.images) && device.images.length
      ? String(device.images[0] || "").trim()
      : "");
  return (
    resolveCatalogAsset(device.folder, raw) ||
    `/hardware-catalog/hardware/${device.folder}/${device.folder}.png`
  );
}

export function normalizeDeviceImages(device: HardwareCatalogDevice): string[] {
  const raw = Array.isArray(device.images) ? device.images : [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    const src = resolveCatalogAsset(device.folder, item);
    if (!src || seen.has(src)) continue;
    seen.add(src);
    out.push(src);
  }

  const hero = resolveDeviceHero(device);
  if (hero && !seen.has(hero)) out.unshift(hero);

  return out;
}

export function prettyTitle(folderOrTitle: string): string {
  return String(folderOrTitle || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDesignDate(raw: string):
  | { y: number; m: number; d: number; precision: "year" | "month" | "day" }
  | { raw: string; precision: "raw" }
  | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^\d{4}$/.test(s)) return { y: Number(s), m: 1, d: 1, precision: "year" };
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, m] = s.split("-").map((n) => Number(n));
    if (!y || !m) return null;
    return { y, m, d: 1, precision: "month" };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map((n) => Number(n));
    if (!y || !m || !d) return null;
    return { y, m, d, precision: "day" };
  }
  return { raw: s, precision: "raw" };
}

export function dateSortKey(raw: string | undefined): number {
  const parsed = parseDesignDate(raw || "");
  if (!parsed || parsed.precision === "raw") return Number.NEGATIVE_INFINITY;
  return parsed.y * 10000 + parsed.m * 100 + parsed.d;
}

export function prettyDesignDate(raw: string | undefined): string {
  const parsed = parseDesignDate(raw || "");
  if (!parsed) return "Undated";
  if (parsed.precision === "raw") return String(parsed.raw);

  const dt = new Date(parsed.y, (parsed.m || 1) - 1, parsed.d || 1);
  if (Number.isNaN(dt.getTime())) return "Undated";

  if (parsed.precision === "year") return String(parsed.y);
  if (parsed.precision === "month") {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      year: "numeric",
    }).format(dt);
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(dt);
}
