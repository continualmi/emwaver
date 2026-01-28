export type HardwareCatalogDevice = {
  folder: string;
  title?: string;
  displayTitle?: string;
  group?: string;
  status?: string;
  image?: string;
  images?: string[];
  designDate?: string;
  date?: string;
  description?: string;
  tags?: string[];
  appSupport?: string[];
};

export type HardwareCatalogManifest = string[];
