const REPO_TO_LOCAL_CATALOG_SLUG: Record<string, string> = {
  "emwaver-core": "EMWAVER_DIY",
  "emwaver-carrier": "EMWAVER_DIY",
  "emwaver-shield": "EMWAVER_SHIELD",
  "gpio-waver": "GPIO_WAVER",
  "infrared-waver": "INFRARED_WAVER",
  "ism-waver": "ISM_WAVER",
  "rfid-waver": "RFID_WAVER",
  "emwaver-air": "emwaver-v2",
};

const EMWAVER_LINK_PHOTOSHOOT = new Set([
  "IMG_0130.webp",
  "IMG_0142.webp",
  "IMG_0143.webp",
  "IMG_0146.webp",
  "IMG_0147.webp",
  "IMG_0148.webp",
  "IMG_0149.webp",
  "IMG_0150.webp",
  "IMG_0151.webp",
  "IMG_0152.webp",
  "IMG_0153.webp",
  "IMG_0154.webp",
  "IMG_0156.webp",
  "IMG_0160.webp",
  "IMG_0162.webp",
  "IMG_0164.webp",
]);

const EMWAVER_LINK_MODULE_PHOTOS = new Set([
  "IMG_0178.webp",
  "IMG_0179.webp",
  "IMG_0180.webp",
  "IMG_0181.webp",
  "IMG_0183.webp",
  "IMG_0184.webp",
  "IMG_0185.webp",
  "IMG_0186.webp",
]);

export function getCatalogImageFallbackPath(src: string): string | null {
  if (!src.includes("raw.githubusercontent.com/continualmi/")) return null;

  const match = src.match(/raw\.githubusercontent\.com\/continualmi\/([^/]+)\/main\/catalog\/images\/([^?#]+)/);
  if (!match) return null;

  const [, repo, filename] = match;

  if (repo === "emwaver-link") {
    if (EMWAVER_LINK_PHOTOSHOOT.has(filename)) {
      return `/hardware-catalog/hardware/emwaver_photoshoot/${filename}`;
    }
    if (EMWAVER_LINK_MODULE_PHOTOS.has(filename)) {
      return `/hardware-catalog/hardware/emwaver_photoshoot_modules/${filename}`;
    }
    if (filename === "emwaver-link.png") {
      return "/hardware-catalog/hardware/emwaver/emwaver.png";
    }
    if (filename === "emwaver-link-all.png") {
      return "/hardware-catalog/hardware/emwaver/emwaver_all.png";
    }
    if (filename === "emwaver-link.webp") {
      return "/hardware-catalog/hardware/emwaver_photoshoot/IMG_0149.webp";
    }
    return null;
  }

  const slug = REPO_TO_LOCAL_CATALOG_SLUG[repo];
  if (!slug) return null;
  return `/hardware-catalog/hardware/${slug}/${filename}`;
}
