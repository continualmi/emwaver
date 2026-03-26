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
  casingImage: string | null;
  caseDownloads: { label: string; href: string }[];
  buildAssets: BuildAsset[];
  tags: string[];
  appSupport: string[];
  parent: string | null;
  requires: string[];
  designDate: string | null;
  reproductionCost: { amount?: number; currency?: string; units?: number } | null;
  easyEdaUrl: string | null;
  schematicUrl: string | null;
  githubUrl: string | null;
};

export type BuildAssetKey =
  | "bom"
  | "cpl"
  | "gerbers"
  | "schematic"
  | "pcb"
  | "case";

export type BuildAsset = {
  key: BuildAssetKey;
  label: string;
  href: string | null;
  available: boolean;
  mode: "download" | "external";
};

type DeviceManifest = Partial<HardwareDevice> & {
  displayTitle?: string;
  caseDownloadUrl?: string;
  buildAssets?: Partial<Record<BuildAssetKey, string>>;
  buildAssetFolders?: Partial<Record<BuildAssetKey, string>>;
};

const PUBLIC_ROOT = path.join(process.cwd(), "public", "hardware-catalog", "hardware");
const MANIFEST_FILE = path.join(PUBLIC_ROOT, "devices.json");

const CURRENT_BOARD_IDS = [
  "EMWAVER_DIY",
  "EMWAVER_DIY_V1",
  "EMWAVER_SHIELD",
  "RFID_WAVER",
  "emwaver",
  "emwaver-v2",
  "ISM_WAVER",
  "GPIO_WAVER",
  "INFRARED_WAVER",
];

const BUILD_ASSET_SPECS: Array<{
  key: BuildAssetKey;
  label: string;
  matchers: RegExp[];
}> = [
  { key: "bom", label: "BOM", matchers: [/\bbom\b/i] },
  { key: "cpl", label: "CPL / CLP", matchers: [/\bcpl\b/i, /\bclp\b/i, /\bplacement\b/i] },
  {
    key: "gerbers",
    label: "Gerbers",
    matchers: [/\bgerber\b/i, /\bgerbers\b/i, /gerber.*\.zip$/i, /\.gbr$/i, /\.drl$/i],
  },
  {
    key: "schematic",
    label: "Schematic",
    matchers: [/\bschematic\b/i, /\bschematics\b/i, /\bschem\b/i, /\.sch$/i, /\.kicad_sch$/i],
  },
  { key: "pcb", label: "PCB", matchers: [/\bpcb\b/i] },
  { key: "case", label: "Case", matchers: [/\bcase\b/i, /\.stl$/i] },
];

function normalizeString(value: unknown): string {
  return String(value || "").trim();
}

function githubRawBaseUrl(githubUrl: string): string {
  return githubUrl
    .replace("https://github.com/", "https://raw.githubusercontent.com/")
    .replace(/\/$/, "");
}

function ensureGithubAssetPath(
  githubUrl: string | null,
  value: unknown,
): string {
  const raw = normalizeString(value);
  if (!raw) return "";

  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;

  if (raw.startsWith("github:")) {
    if (!githubUrl) return "";
    const relativePath = raw.slice("github:".length).replace(/^\/+/, "");
    if (!relativePath) return githubUrl;
    return `${githubRawBaseUrl(githubUrl)}/main/${relativePath}`;
  }

  return "";
}

function ensureCatalogAssetPath(
  slug: string,
  value: unknown,
  githubUrl: string | null = null,
): string {
  const raw = normalizeString(value);
  if (!raw) return `/hardware-catalog/hardware/${slug}/${slug}.png`;
  const githubAssetPath = ensureGithubAssetPath(githubUrl, raw);
  if (githubAssetPath) return githubAssetPath;
  if (raw.startsWith("/hardware-catalog/")) return raw;
  if (raw.startsWith("hardware/")) return `/hardware-catalog/${raw}`;
  if (raw.startsWith("downloads/")) return `/hardware-catalog/${raw}`;
  if (raw.includes("/")) return `/hardware-catalog/hardware/${raw}`;
  return `/hardware-catalog/hardware/${slug}/${raw}`;
}

function ensureBuildAssetHref(
  githubUrl: string | null,
  value: unknown,
): { href: string | null; mode: "download" | "external" } {
  const raw = normalizeString(value);
  if (!raw) {
    return { href: null, mode: "external" };
  }

  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return {
      href: raw,
      mode:
        raw.includes("raw.githubusercontent.com/") ||
        raw.includes("/raw/") ||
        raw.includes("?raw=1")
          ? "download"
          : "external",
    };
  }

  if (!githubUrl) {
    return { href: null, mode: "external" };
  }

  const relativePath = raw.startsWith("github:")
    ? raw.slice("github:".length).replace(/^\/+/, "")
    : raw.replace(/^\/+/, "");

  if (!relativePath) {
    return { href: githubUrl, mode: "external" };
  }

  const looksLikeFile = /\.[a-z0-9]+$/i.test(relativePath);
  if (looksLikeFile) {
    const rawGithubUrl = githubRawBaseUrl(githubUrl);
    return {
      href: `${rawGithubUrl}/main/${relativePath}`,
      mode: "download",
    };
  }

  return {
    href: `${githubUrl.replace(/\/$/, "")}/tree/main/${relativePath}`,
    mode: "external",
  };
}

function ensureImagePath(slug: string, value: unknown, githubUrl: string | null): string {
  return ensureCatalogAssetPath(slug, value, githubUrl);
}

function resolveBuildAssets(
  _slug: string,
  data: DeviceManifest,
  caseDownloads: { label: string; href: string }[],
): BuildAsset[] {
  const githubUrl = normalizeString(data.githubUrl) || null;
  const manifestAssets = data.buildAssets && typeof data.buildAssets === "object"
    ? data.buildAssets
    : {};
  const manifestFolders =
    data.buildAssetFolders && typeof data.buildAssetFolders === "object"
      ? data.buildAssetFolders
      : {};

  return BUILD_ASSET_SPECS.map(({ key, label }) => {
    const manifestHref = normalizeString(manifestAssets[key]);
    if (manifestHref) {
      const resolved = ensureBuildAssetHref(githubUrl, manifestHref);
      return {
        key,
        label,
        href: resolved.href,
        available: Boolean(resolved.href),
        mode: resolved.mode,
      };
    }

    if (key === "case" && caseDownloads.length > 0) {
      const resolved = ensureBuildAssetHref(githubUrl, caseDownloads[0].href);
      return {
        key,
        label,
        href: resolved.href,
        available: Boolean(resolved.href),
        mode: resolved.mode,
      };
    }

    const folderHint = normalizeString(manifestFolders[key]);
    if (folderHint) {
      const folderHref = ensureBuildAssetHref(githubUrl, folderHint);
      return {
        key,
        label,
        href: folderHref.href,
        available: Boolean(folderHref.href),
        mode: folderHref.mode,
      };
    }

    if (githubUrl) {
      return {
        key,
        label,
        href: githubUrl,
        available: true,
        mode: "external",
      };
    }

    return {
      key,
      label,
      href: null,
      available: false,
      mode: "external",
    };
  });
}

function parseManifest(slug: string): HardwareDevice {
  const file = path.join(PUBLIC_ROOT, slug, "device.json");
  const raw = fs.readFileSync(file, "utf8");
  const data = JSON.parse(raw) as DeviceManifest;
  const githubUrl = normalizeString(data.githubUrl) || null;

  const images = Array.isArray(data.images) ? data.images : [];
  const normalizedImages = Array.from(
    new Set(images.map((value) => ensureImagePath(slug, value, githubUrl)).filter(Boolean)),
  );
  const rawCaseDownloads = Array.isArray(data.caseDownloads) ? data.caseDownloads : [];
  const caseDownloads = rawCaseDownloads
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const href = ensureCatalogAssetPath(slug, (entry as { href?: unknown }).href, githubUrl);
      if (!href) return null;
      return {
        label: normalizeString((entry as { label?: unknown }).label) || "Case file",
        href,
      };
    })
    .filter((entry): entry is { label: string; href: string } => Boolean(entry));

  const legacyCaseDownload = normalizeString(data.caseDownloadUrl);
  if (legacyCaseDownload) {
    caseDownloads.push({
      label: "STL",
      href: ensureCatalogAssetPath(slug, legacyCaseDownload, githubUrl),
    });
  }
  const normalizedCaseDownloads = Array.from(
    new Map(caseDownloads.map((entry) => [entry.href, entry])).values(),
  );

  const primaryImage =
    normalizedImages[0] || ensureImagePath(slug, data.image || `${slug}.png`, githubUrl);

  return {
    slug,
    title: normalizeString(data.displayTitle || data.title || slug),
    group: normalizeString(data.group),
    status: normalizeString(data.status || "device"),
    experimental:
      Boolean(data.experimental) || normalizeString((data as { lifecycle?: unknown }).lifecycle).toLowerCase() === "experimental",
    description: normalizeString(data.description),
    image: primaryImage,
    images: normalizedImages.length ? normalizedImages : [primaryImage],
    casingImage: normalizeString(data.casingImage)
      ? ensureCatalogAssetPath(slug, data.casingImage, githubUrl)
      : null,
    caseDownloads: normalizedCaseDownloads,
    buildAssets: resolveBuildAssets(
      slug,
      data,
      normalizedCaseDownloads,
    ),
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
    easyEdaUrl: normalizeString(data.easyEdaUrl) || null,
    schematicUrl: normalizeString(data.schematicUrl) || null,
    githubUrl,
  };
}

function loadAllDevices(): HardwareDevice[] {
  const ids = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8")) as string[];
  return ids
    .map((slug) => parseManifest(slug))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function getHardwareCatalog(): HardwareDevice[] {
  return loadAllDevices();
}

export function getHardwareDevice(slug: string): HardwareDevice | null {
  return getHardwareCatalog().find((device) => device.slug === slug) || null;
}

export function getCurrentBoards(): HardwareDevice[] {
  const devices = getHardwareCatalog();
  return CURRENT_BOARD_IDS.map((slug) => devices.find((device) => device.slug === slug)).filter(
    (device): device is HardwareDevice => Boolean(device),
  );
}

export function getArchiveDevices(): HardwareDevice[] {
  return getHardwareCatalog().filter(
    (device) => !CURRENT_BOARD_IDS.includes(device.slug),
  );
}

export function getRelatedHardware(device: HardwareDevice): HardwareDevice[] {
  const devices = getHardwareCatalog();
  return devices.filter(
    (candidate) =>
      candidate.slug !== device.slug &&
      (candidate.parent === device.slug || device.parent === candidate.slug || candidate.group === device.group),
  );
}
